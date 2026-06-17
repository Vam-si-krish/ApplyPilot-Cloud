# AI Workflow — ApplyPilot-Cloud

## The loop
```
research → spec → plan → implement → verify → record
```
Specs (PRD, ARCHITECTURE, ADRs) are written before code. Work proceeds in commit-sized
slices. After each slice the mechanical gates run: `npm run typecheck`, `npm run test`,
`npm run build`. The scoring step — the component a human can't eyeball — is pinned by
`evals/cases/` so a behaviour change is caught, not vibed.

## How AI assistance is used here
This project is itself built with an AI agent. The scoring/LLM logic is *ported* from a
known-good Python reference (`../ApplyPilot-Lite/`), so the agent's job is faithful
translation, not invention — and the eval cases verify the translation.

## Trust-calibration table
| Output | Trusted on | Verified by |
|---|---|---|
| Next/Tailwind/TS config, boilerplate | `build` + `typecheck` pass | typecheck, build |
| `SCORE_PROMPT` text | nothing — must be verbatim | diff against `scorer.py`; eval cases |
| `parseScoreResponse` | nothing — core contract | unit tests with hand-computed expectations |
| LLM provider request shapes (Gemini native, Anthropic Messages) | nothing — external payloads | compared to `llm.py`; integration smoke test |
| Apify dataset field names | nothing — external payload | defensive mapping + confirm against a real run |
| Score values from the model | never fabricated | one call/job; parse failure → score 0 (visible) |
| Request bodies / webhook payloads | nothing | validated at the route boundary before DB writes |

## The invariant the evals protect
Same resume + same job description ⇒ same parsed score/fields as the Python version.
Real misjudgements found later become permanent regression cases in `evals/cases/`.
