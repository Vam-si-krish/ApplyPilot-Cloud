# 0064 — Subscription-mode prompt caching fix + per-résumé token usage

## Context

Tailoring runs in subscription mode via the Agent SDK (ADR 0042). A caching audit found
the carefully designed cache breakpoint (ADR 0031/0056) never survives that path:

- `agentClient.toPromptAndSystem` flattens the user message's segments into one string,
  **silently discarding the `cache: true` breakpoint** between the stable base-résumé
  block and the volatile job block.
- What remained cacheable was only the system prompt (~2.2k tokens) — **below Haiku 4.5's
  4,096-token minimum cacheable prefix**, so on the current `haiku` tailor model, cross-job
  caching was effectively zero. Every tailor re-paid the full ~5.6k input tokens.

Separately, the user wants to see what each résumé generation costs in tokens (to reason
about how many applications fit in a 5-hour subscription window) — the worker logged usage
but nothing was persisted or surfaced.

## Decision

**Caching — restructure the tailor call (both prompt copies):**
`buildTailorMessages` now emits THREE messages: `system(TAILOR_PROMPT)`,
`system(baseBlock, cache: true)`, `user(jobBlock)`.

- **Subscription mode**: `toPromptAndSystem` folds all system roles into the SDK's
  `systemPrompt`, which the Claude CLI auto-caches — the stable prefix (prompt + base
  résumé + budget ≈ 4.1k tokens) is now cached across jobs; only the ~1.5k-token job
  block is volatile. 4.1k clears Sonnet's 2,048-token minimum comfortably and sits just
  above Haiku's 4,096 (one more reason Sonnet is the better tailor model).
- **Direct-API Anthropic** (both `chatAnthropic` copies): `system` is now sent as
  **blocks**, mapping a `cache: true` segment to a real `cache_control` breakpoint — the
  breakpoint on the base block caches the whole prefix ahead of it (strictly better than
  the old user-segment breakpoint, which left the system prompt outside API-mode caching
  was fine but system-string had no marker).
- **Gemini/compat**: system parts flatten in order — the stable prefix stays byte-stable,
  so implicit provider-side prefix caching is preserved.

**Usage tracking:**
- `agentClient` captures the SDK result's usage (tokens in/out, cache read/write,
  `total_cost_usd`) as `client.lastUsage`; the worker `LLMClient` does the same for the
  Anthropic / Gemini / OpenAI-compat paths.
- `tailorResume` returns `usage` (+ model + wall-clock ms); both worker tailor flows
  persist it to the new `applications.tailor_usage` jsonb column (migration 0039).
- Tailor & Apply's expanded panel shows a "Generation: X in (+Y cached) · Z out · $ · s ·
  model" line, so cache health is visible per row (0 cached = miss).

## Consequences

- Verification is built in: the worker log's `cacheRead=` and the UI line should show
  ~4k cached tokens on every drain call after the first (queue runs back-to-back, inside
  the 5-minute cache TTL). Before this change it was structurally always 0.
- Output tokens dominate tailoring cost, so the fix buys roughly 15–20% window headroom —
  the bigger lever remains the tailor-model choice (haiku vs sonnet ≈ 3×).
- ⚠ Requires a Worker Mac deploy (`git pull` + restart) — tailor.js, agentClient.js,
  server.js all changed. Migration 0039 already applied live.
- `tailor_usage` records the LAST generation only (regenerate overwrites) — that matches
  the row's résumé, which is also the last generation.
