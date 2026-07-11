/**
 * Model pricing → per-call USD cost (ADR 0068).
 *
 * In subscription mode the Agent SDK draws from the plan's usage window and reports
 * `total_cost_usd` as null, so the scoring readout had no dollar figure. We instead
 * derive the ACTUAL API-equivalent cost from the token breakdown the call already
 * reports, using each model's published per-million-token rates. Anthropic's usage
 * convention: `input_tokens` is the UNCACHED remainder — cache reads and cache writes
 * are billed separately at their own (much lower / slightly higher) rates.
 */

import type { ScoreUsage } from "./types";

/** Per-million-token rates in USD. cache_read ≈ 0.1× input; cache_write(5m) ≈ 1.25× input. */
interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Keyed by a substring of the model id (matched case-insensitively; first match wins,
// so specific ids go before family fallbacks). Scoring runs on Haiku 4.5; the others
// are here so a model swap still costs correctly. GPT rates cover the ChatGPT
// subscription lane (ADR 0069), whose Codex SDK reports tokens but no cost_usd —
// rates per OpenAI's published July 2026 pricing (cache read = 0.1× input).
const RATES: Array<{ match: string; rates: ModelRates }> = [
  { match: "haiku-4-5", rates: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: "haiku", rates: { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: "sonnet", rates: { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: "opus", rates: { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: "gpt-5.6-sol", rates: { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: "gpt-5.6-terra", rates: { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 3.125 } },
  { match: "gpt-5.6-luna", rates: { input: 1.0, output: 6.0, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: "gpt-5.5", rates: { input: 5.0, output: 30.0, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: "gpt-5.4", rates: { input: 2.5, output: 15.0, cacheRead: 0.25, cacheWrite: 3.125 } },
];

function ratesFor(model: string | null | undefined): ModelRates | null {
  if (!model) return null;
  const m = model.toLowerCase();
  return RATES.find((r) => m.includes(r.match))?.rates ?? null;
}

/**
 * Actual API-equivalent USD cost of one LLM call (scoring or tailoring — TailorUsage is
 * structurally identical), computed from its token breakdown. Returns null only when we
 * can't price it (unknown model AND no SDK-reported cost). Prefers the derived figure so
 * the number is consistent with the tokens shown; falls back to the SDK's `cost_usd` for
 * unknown models.
 */
export function scoreUsageCostUsd(usage: ScoreUsage | null | undefined): number | null {
  if (!usage) return null;
  const rates = ratesFor(usage.model);
  if (!rates) return typeof usage.cost_usd === "number" ? usage.cost_usd : null;
  const per = (tokens: number | null | undefined, rate: number) =>
    ((tokens ?? 0) / 1_000_000) * rate;
  return (
    per(usage.input_tokens, rates.input) +
    per(usage.cache_read_input_tokens, rates.cacheRead) +
    per(usage.cache_creation_input_tokens, rates.cacheWrite) +
    per(usage.output_tokens, rates.output)
  );
}
