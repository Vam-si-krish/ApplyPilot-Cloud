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
 * Auth (one-time, on this machine): `claude setup-token` → set CLAUDE_CODE_OAUTH_TOKEN,
 * or just `claude login`. CRITICAL: we run the SDK with ANTHROPIC_API_KEY /
 * ANTHROPIC_AUTH_TOKEN stripped from its environment — those take precedence over the
 * subscription and would silently bill the API instead (see the auth-precedence docs).
 *
 * Robustness (ADR 0042 follow-up): every call is bounded by an AbortController timeout
 * so a stalled SDK subprocess (e.g. an un-authenticated `claude` waiting for login under
 * launchd, which has no Keychain access) FAILS LOUDLY instead of hanging a tailoring row
 * forever. Every call is logged (model, prompt sizes, auth-env presence, the CLI's
 * stderr, duration, outcome) so issues can be pinpointed from the worker log.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';

// Hard ceiling for one SDK call. Tailoring (~4000 tokens) can take 30–90s; 160s leaves
// headroom while staying UNDER the Applications UI's 180s generate-poll deadline — so a
// stalled call fails the row VISIBLY (status 'failed' + reason) before the UI gives up,
// instead of looking like it "keeps loading". Override with AGENT_SDK_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = Math.max(15_000, Number(process.env.AGENT_SDK_TIMEOUT_MS) || 160_000);

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
 * Environment for the SDK subprocess. The SDK *replaces* (not merges) the subprocess
 * env, so we copy the parent env MINUS the API-key vars (which would override the
 * subscription) and keep CLAUDE_CODE_OAUTH_TOKEN if present.
 */
function subscriptionEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN') continue;
    if (v != null) env[k] = v;
  }
  return env;
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
    /** One single-turn completion. Returns the assistant text (temperature/maxTokens
     *  are accepted for interface parity but the SDK/CLI does not expose them). */
    async chat(messages, _opts = {}) {
      const rid = Math.random().toString(36).slice(2, 8);
      const { system, prompt } = toPromptAndSystem(messages);
      const t0 = Date.now();
      // Log the auth-env shape up front — the usual failure is a missing OAuth token /
      // a stray ANTHROPIC_API_KEY / a launchd process with no HOME (so no credentials).
      console.log(
        `[agent ${rid}] start task=${label} model=${resolvedModel} systemLen=${system.length} promptLen=${prompt.length} ` +
          `auth{oauthToken=${!!process.env.CLAUDE_CODE_OAUTH_TOKEN} apiKey=${!!process.env.ANTHROPIC_API_KEY} ` +
          `authToken=${!!process.env.ANTHROPIC_AUTH_TOKEN} HOME=${!!process.env.HOME}}`,
      );

      const ac = new AbortController();
      const timeoutMs = Number(_opts.timeoutMs) > 0 ? Number(_opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        console.error(`[agent ${rid}] TIMEOUT task=${label} after ${timeoutMs}ms — aborting the SDK call`);
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
        model: resolvedModel,
        maxTurns: 1, // single completion — never an agentic loop
        allowedTools: [], // no tools: behave as a plain text model
        settingSources: [], // ignore any filesystem settings / project CLAUDE.md
        permissionMode: 'bypassPermissions',
        cwd: os.tmpdir(), // neutral cwd — no repo context leaks in
        env: subscriptionEnv(),
        abortController: ac,
        stderr: onStderr,
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
              `[agent ${rid}] result task=${label} subtype=${msg.subtype} turns=${msg.num_turns ?? '?'} costUsd=${msg.total_cost_usd ?? '?'}`,
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
          ? `Agent SDK timed out after ${timeoutMs}ms (model=${resolvedModel}, task=${label}) — the worker likely isn't authenticated to the Claude subscription (run \`claude setup-token\` and set CLAUDE_CODE_OAUTH_TOKEN).`
          : `Agent SDK error (model=${resolvedModel}, task=${label}): ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[agent ${rid}] FAIL ${base}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
        throw new Error(`${base}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
      }
      clearTimeout(timer);

      const text = parts.join('').trim() || resultText.trim();
      const dur = Date.now() - t0;
      if (!text) {
        const stderrTail = stderrChunks.join('').slice(-700).trim();
        const msg =
          failure ||
          `Agent SDK returned no text after ${dur}ms (model=${resolvedModel}, task=${label}) — is the worker logged into Claude? run \`claude setup-token\`.`;
        console.error(`[agent ${rid}] EMPTY ${msg}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
        throw new Error(`${msg}${stderrTail ? ` | stderr: ${stderrTail}` : ''}`);
      }
      console.log(`[agent ${rid}] done task=${label} ${dur}ms textLen=${text.length}`);
      return text;
    },
  };
}
