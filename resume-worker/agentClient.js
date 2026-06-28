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
 * `makeAgentClient(model)` returns an object with the SAME `.chat(messages, opts)`
 * contract as tailor.js's LLMClient, so it drops in wherever a client is expected.
 *
 * Auth (one-time, on this machine): `claude setup-token` → set CLAUDE_CODE_OAUTH_TOKEN,
 * or just `claude login`. CRITICAL: we run the SDK with ANTHROPIC_API_KEY /
 * ANTHROPIC_AUTH_TOKEN stripped from its environment — those take precedence over the
 * subscription and would silently bill the API instead (see the auth-precedence docs).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';

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
    env[k] = v;
  }
  return env;
}

/**
 * Build a subscription-backed client. `model` is an Agent-SDK alias ('sonnet' |
 * 'opus' | 'haiku') or a full Claude model id; falls back to 'sonnet'.
 */
export function makeAgentClient(model) {
  const resolvedModel = (model || '').trim() || 'sonnet';
  return {
    model: resolvedModel,
    /** One single-turn completion. Returns the assistant text (temperature/maxTokens
     *  are accepted for interface parity but the SDK/CLI does not expose them). */
    async chat(messages, _opts = {}) {
      const { system, prompt } = toPromptAndSystem(messages);

      const options = {
        model: resolvedModel,
        maxTurns: 1, // single completion — never an agentic loop
        allowedTools: [], // no tools: behave as a plain text model
        settingSources: [], // ignore any filesystem settings / project CLAUDE.md
        permissionMode: 'bypassPermissions',
        cwd: os.tmpdir(), // neutral cwd — no repo context leaks in
        env: subscriptionEnv(),
      };
      if (system) options.systemPrompt = system; // custom string replaces the default
      if (process.env.CLAUDE_CLI_PATH) options.pathToClaudeCodeExecutable = process.env.CLAUDE_CLI_PATH;

      const parts = [];
      let resultText = '';
      let failure = null;
      for await (const msg of query({ prompt, options })) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content || []) {
            if (block.type === 'text') parts.push(block.text);
          }
        } else if (msg.type === 'result') {
          resultText = typeof msg.result === 'string' ? msg.result : '';
          if (msg.subtype && msg.subtype !== 'success') {
            failure = `Agent SDK ${msg.subtype}${resultText ? `: ${resultText}` : ''}`;
          }
        }
      }

      const text = parts.join('').trim() || resultText.trim();
      if (!text) throw new Error(failure || 'Agent SDK returned no text (is the worker logged into Claude?)');
      return text;
    },
  };
}
