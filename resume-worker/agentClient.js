/**
 * Claude-subscription LLM backend for the worker (ADR 0042).
 *
 * Runs a prompt on the user's Claude Pro/Max subscription via the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`), which drives the `claude` CLI locally — no
 * per-token API key is billed (it draws from the plan's monthly Agent-SDK credit).
 * This can ONLY run here on the always-on Mac (serverless can't spawn the CLI), so
 * the worker is the single home for subscription-mode AI: the cloud app's serverless
 * lanes reach it via POST /llm, and the worker's own tasks (tailoring, cover letters,
 * one-page condense) build this client directly.
 *
 * `makeAgentClient(model, label)` returns an object with the SAME `.chat(messages,
 * opts)` contract as tailor.js's LLMClient, so it drops in wherever a client is
 * expected.
 *
 * ── MULTI-ACCOUNT (two+ Claude subscriptions) ───────────────────────────────────
 * Each Claude plan has its own monthly Agent-SDK credit pool, so two accounts double
 * the effective cap. The mechanism is the one Anthropic documents and tools like
 * Meridian use in production: **each account is an isolated CLAUDE_CONFIG_DIR** that
 * holds its own login (a `.credentials.json` with a refresh token, written once by
 * `CLAUDE_CONFIG_DIR=<dir> claude login`) — credentials are isolated PER DIR, NOT in
 * the shared macOS Keychain. We switch accounts purely by pointing the SDK subprocess
 * at a different config dir.
 *
 *   Account 1 : the default login (system Keychain) unless CLAUDE_CONFIG_DIR_1 is set.
 *   Account N : CLAUDE_CONFIG_DIR_N=<dir>  (defaults to ~/.claude-acctN; auto-detected
 *               if that dir exists), optionally CLAUDE_CODE_OAUTH_TOKEN_N=<setup-token>
 *               for a headless token instead of an interactive login.
 *   CLAUDE_ACTIVE_ACCOUNT=1|2  — MANUAL: which account is tried FIRST (or run
 *               ./switch-account.sh 1|2, which sets it and restarts the worker).
 *   AUTO       — if the active account fails FAST (credit cap / auth / rate limit), the
 *               call transparently fails over to the next account. It does NOT fail over
 *               on a TIMEOUT (a stall), so one tailoring call can't spend 2×160s and
 *               blow the Applications UI's 180s deadline.
 *
 * Setup per extra account (one-time, on this Mac, in a browser):
 *   CLAUDE_CONFIG_DIR=~/.claude-acct2 claude   # log into ACCOUNT 2 → creds saved there
 * (account 1 already works via its existing login.) CRITICAL: we run the SDK with
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN stripped — those take precedence over the
 * subscription and would silently bill the API instead.
 *
 * Robustness (ADR 0042 follow-up): every call is bounded by an AbortController timeout
 * so a stalled SDK subprocess FAILS LOUDLY instead of hanging a tailoring row forever.
 * Every call is logged (account, config dir, model, prompt sizes, auth-env presence,
 * the CLI's stderr, duration, outcome) so issues can be pinpointed from the worker log.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Hard ceiling for one SDK call. Tailoring (~4000 tokens) can take 30–90s; 160s leaves
// headroom while staying UNDER the Applications UI's 180s generate-poll deadline — so a
// stalled call fails the row VISIBLY (status 'failed' + reason) before the UI gives up,
// instead of looking like it "keeps loading". Override with AGENT_SDK_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = Math.max(15_000, Number(process.env.AGENT_SDK_TIMEOUT_MS) || 160_000);

// How many account slots to scan (account 1 + CLAUDE_CONFIG_DIR_2..N / *_TOKEN_2..N).
const MAX_ACCOUNTS = 5;

/** String or [{ text }] segments → one string (mirrors tailor.js flattenContent). */
function flattenContent(content) {
  return typeof content === 'string' ? content : content.map((p) => p.text).join('\n\n');
}

/**
 * Split chat messages into the SDK's shape: system roles → a single systemPrompt
 * string; the remaining turns → one prompt. A lone user turn passes through verbatim;
 * a real back-and-forth (the assistant chat) is labelled so context survives a
 * single-turn call.
 */
function toPromptAndSystem(messages) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => flattenContent(m.content))
    .join('\n\n');
  const convo = messages.filter((m) => m.role !== 'system');
  const prompt =
    convo.length === 1
      ? flattenContent(convo[0].content)
      : convo.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${flattenContent(m.content)}`).join('\n\n');
  return { system, prompt };
}

/**
 * Build the env for the SDK subprocess for a specific account. The SDK *replaces* (not
 * merges) the subprocess env, so we copy the parent env, then:
 *  - strip ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (they'd override the subscription),
 *  - strip the inherited CLAUDE_CONFIG_DIR / CLAUDE_CODE_OAUTH_TOKEN and set them
 *    per-account, so each account resolves to its OWN isolated credentials.
 */
function subscriptionEnv(account) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN') continue;
    if (k === 'CLAUDE_CONFIG_DIR' || k === 'CLAUDE_CODE_OAUTH_TOKEN') continue; // set per-account below
    if (v != null) env[k] = v;
  }
  // An isolated config dir makes the account's own login authoritative; the default
  // (~/.claude, backed by the macOS Keychain) is used only for account 1 when no dir set.
  if (account.configDir) env.CLAUDE_CONFIG_DIR = account.configDir;
  // A setup-token is the headless alternative to an in-dir login; only set when provided.
  if (account.token) env.CLAUDE_CODE_OAUTH_TOKEN = account.token;
  return env;
}

/**
 * Ordered list of subscription accounts to try, each `{ id, configDir, token }`:
 *   - Account 1 = the default login (system Keychain) unless CLAUDE_CONFIG_DIR_1 is set.
 *   - Account N (2..MAX) is included when configured: CLAUDE_CONFIG_DIR_N set, OR
 *     CLAUDE_CODE_OAUTH_TOKEN_N set, OR its default dir ~/.claude-acctN exists on disk.
 * CLAUDE_ACTIVE_ACCOUNT (default 1) is placed FIRST (manual switch); the rest follow in
 * id order as automatic failover.
 */
export function resolveAccounts(env = process.env) {
  const home = env.HOME || os.homedir();
  const accounts = [];

  // Account 1 — always present; default config dir (Keychain) unless explicitly isolated.
  accounts.push({
    id: 1,
    configDir: (env.CLAUDE_CONFIG_DIR_1 || '').trim() || undefined,
    token: (env.CLAUDE_CODE_OAUTH_TOKEN || '').trim() || undefined,
  });

  // Accounts 2..N — only if actually configured (explicit dir/token or the dir exists).
  for (let i = 2; i <= MAX_ACCOUNTS; i++) {
    const explicitDir = (env[`CLAUDE_CONFIG_DIR_${i}`] || '').trim();
    const token = (env[`CLAUDE_CODE_OAUTH_TOKEN_${i}`] || '').trim();
    const defaultDir = join(home, `.claude-acct${i}`);
    const configDir = explicitDir || defaultDir;
    if (explicitDir || token || existsSync(configDir)) {
      accounts.push({ id: i, configDir, token: token || undefined });
    }
  }

  const active = Number(env.CLAUDE_ACTIVE_ACCOUNT) || 1;
  const first = accounts.filter((a) => a.id === active);
  const rest = accounts.filter((a) => a.id !== active).sort((a, b) => a.id - b.id);
  return first.length ? [...first, ...rest] : accounts;
}

/**
 * Run ONE single-turn SDK completion on a specific account. Throws on failure; the
 * thrown error carries `.isTimeout` so the caller fails over on fast errors but not on
 * a stall.
 */
async function runOnce(messages, opts, account, model, label) {
  const rid = Math.random().toString(36).slice(2, 8);
  const { system, prompt } = toPromptAndSystem(messages);
  const t0 = Date.now();
  const cfg = account.configDir || 'default(keychain)';
  // Log the auth-env shape up front — the usual failure is a missing/!isolated config
  // dir, a stray ANTHROPIC_API_KEY, or a launchd process with no HOME (no credentials).
  console.log(
    `[agent ${rid}] start task=${label} account=${account.id} configDir=${cfg} model=${model} ` +
      `systemLen=${system.length} promptLen=${prompt.length} ` +
      `auth{token=${!!account.token} apiKey=${!!process.env.ANTHROPIC_API_KEY} ` +
      `authToken=${!!process.env.ANTHROPIC_AUTH_TOKEN} HOME=${!!process.env.HOME}}`,
  );

  const ac = new AbortController();
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`[agent ${rid}] TIMEOUT task=${label} account=${account.id} after ${timeoutMs}ms — aborting the SDK call`);
    ac.abort();
  }, timeoutMs);

  const stderrChunks = [];
  const onStderr = (d) => {
    const s = String(d);
    stderrChunks.push(s);
    // Surface the CLI's own diagnostics (auth errors, etc.) — capped so a chatty
    // process can't flood the log.
    if (stderrChunks.join('').length < 6000) console.log(`[agent ${rid}] stderr: ${s.trim()}`);
  };

  const options = {
    // Headroom, not an agentic loop: with allowedTools:[] the model can't DO anything
    // multi-step, but a large single completion (e.g. a full tailored résumé) can spill
    // into a 2nd SDK "turn" — at maxTurns:1 that surfaces as error_max_turns. A small
    // ceiling lets it finish; it still stops as soon as the text is produced.
    maxTurns: Math.max(1, Number(process.env.AGENT_SDK_MAX_TURNS) || 8),
    allowedTools: [], // no tools: behave as a plain text model
    settingSources: [], // ignore any filesystem settings / project CLAUDE.md
    permissionMode: 'bypassPermissions',
    cwd: os.tmpdir(), // neutral cwd — no repo context leaks in
    env: subscriptionEnv(account),
    abortController: ac,
    stderr: onStderr,
    // Disable extended thinking. These are single-shot structured generations (score,
    // tailor, cover letter); the SDK's default adaptive 'high'-effort thinking burns
    // thousands of thinking tokens and adds MINUTES of latency (~145s tailors) with no
    // quality gain over the original API-mode calls (which never used thinking). Set
    // AGENT_SDK_THINKING=enabled to restore it if ever needed.
    ...(process.env.AGENT_SDK_THINKING === 'enabled' ? {} : { thinking: { type: 'disabled' } }),
  };
  if (system) options.systemPrompt = system; // custom string replaces the default
  if (process.env.CLAUDE_CLI_PATH) options.pathToClaudeCodeExecutable = process.env.CLAUDE_CLI_PATH;

  const parts = [];
  let resultText = '';
  let failure = null;
  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content || []) {
          if (block.type === 'text') parts.push(block.text);
        }
      } else if (msg.type === 'result') {
        resultText = typeof msg.result === 'string' ? msg.result : '';
        console.log(
          `[agent ${rid}] result task=${label} account=${account.id} subtype=${msg.subtype} turns=${msg.num_turns ?? '?'} costUsd=${msg.total_cost_usd ?? '?'}`,
        );
        if (msg.subtype && msg.subtype !== 'success') {
          failure = `Agent SDK ${msg.subtype}${resultText ? `: ${resultText}` : ''}`;
        }
      } else if (msg.type === 'system') {
        console.log(`[agent ${rid}] system msg subtype=${msg.subtype ?? '?'}`);
      }
    }
  } catch (e) {
    clearTimeout(timer);
    const stderrTail = stderrChunks.join('').slice(-700).trim();
    const base = timedOut
      ? `Agent SDK timed out after ${timeoutMs}ms (account=${account.id}, model=${model}, task=${label}) — the worker likely isn't authenticated for this account (run \`CLAUDE_CONFIG_DIR=${cfg} claude\` to log in, or set a CLAUDE_CODE_OAUTH_TOKEN).`
      : `Agent SDK error (account=${account.id}, model=${model}, task=${label}): ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[agent ${rid}] FAIL ${base}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
    const err = new Error(`${base}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
    err.isTimeout = timedOut;
    throw err;
  }
  clearTimeout(timer);

  const text = parts.join('').trim() || resultText.trim();
  const dur = Date.now() - t0;
  if (!text) {
    const stderrTail = stderrChunks.join('').slice(-700).trim();
    const msg =
      failure ||
      `Agent SDK returned no text after ${dur}ms (account=${account.id}, model=${model}, task=${label}) — is this account logged in? run \`CLAUDE_CONFIG_DIR=${cfg} claude\`.`;
    console.error(`[agent ${rid}] EMPTY ${msg}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
    const err = new Error(`${msg}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
    err.isTimeout = false; // an empty/cap/limit result is a failover candidate, not a stall
    throw err;
  }
  console.log(`[agent ${rid}] done task=${label} account=${account.id} ${dur}ms textLen=${text.length}`);
  return text;
}

/**
 * Build a subscription-backed client. `model` is an Agent-SDK alias ('sonnet' |
 * 'opus' | 'haiku') or a full Claude model id; falls back to 'sonnet'. `label` tags
 * the log lines so a task is identifiable (e.g. 'llm' | 'tailor' | 'cover' | 'condense').
 */
export function makeAgentClient(model, label = 'agent') {
  const resolvedModel = (model || '').trim() || 'sonnet';
  return {
    model: resolvedModel,
    /** One single-turn completion across the configured accounts (active first, then
     *  automatic failover on a fast failure). Returns the assistant text. */
    async chat(messages, _opts = {}) {
      const accounts = resolveAccounts();
      let lastErr = null;
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const isLast = i === accounts.length - 1;
        try {
          return await runOnce(messages, _opts, account, resolvedModel, label);
        } catch (e) {
          lastErr = e;
          // Fail over only on FAST failures (credit cap / auth / rate / empty result) —
          // not on a stall, so we don't spend the whole UI deadline retrying.
          if (!isLast && !e.isTimeout) {
            console.warn(
              `[agent] account ${account.id} failed → failing over to account ${accounts[i + 1].id}: ${(e.message || '').slice(0, 140)}`,
            );
            continue;
          }
          throw e;
        }
      }
      throw lastErr || new Error('Agent SDK: no subscription accounts configured');
    },
  };
}
