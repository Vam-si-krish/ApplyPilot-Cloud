# AI Workflow — ApplyPilot-Cloud

## The loop
```
research → spec → plan → implement → verify → record
```
Specs (PRD, ARCHITECTURE, ADRs) are written before code. Work proceeds in commit-sized
slices. Before changing a boundary, follow the architecture review in
[DEVELOPMENT.md](DEVELOPMENT.md). After each slice the mechanical gates run:
`npm run typecheck`, `npm run test`, `npm run build`, and `npm run docs:check`.
The scoring step — the component a human cannot reliably eyeball — is pinned by
`evals/cases/` so a behavior change is caught.

## How AI assistance is used here
This project is itself built with AI assistance. The current code, tests, living docs,
and accepted non-superseded ADRs are the source of truth. `ApplyPilot-Lite` is useful
history, but newer ADRs deliberately changed scoring and deployment behavior. An agent
must resolve those decisions before implementing instead of assuming the oldest document
is current.

## Trust-calibration table
| Output | Trusted on | Verified by |
|---|---|---|
| Next/Tailwind/TS config, boilerplate | `build` + `typecheck` pass | typecheck, build |
| `SCORE_PROMPT` text | accepted scoring decisions | parser tests + labeled eval bands |
| `parseScoreResponse` | nothing — core contract | unit tests with hand-computed expectations |
| LLM provider request shapes (Gemini native, Anthropic Messages) | nothing — external payloads | official provider contract + integration smoke test |
| Apify dataset field names | nothing — external payload | defensive mapping + confirm against a real run |
| Score values from the model | never fabricated | one call/job; parse failure → score 0 (visible) |
| Request bodies / webhook payloads | nothing | validated at the route boundary before DB writes |

## The invariant the evals protect

Labeled résumé + job cases must remain in their expected directional score bands, and
the structured parser contract must remain stable. Real misjudgements become permanent
regression cases in `evals/cases/`; they do not require equality with the retired Python
scorer.
