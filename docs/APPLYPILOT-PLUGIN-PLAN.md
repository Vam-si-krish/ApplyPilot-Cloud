# ApplyPilot plugin and MCP — long-term improvement plan

## Goal

Replace repeated prompt copying with a durable “apply to my assigned jobs” capability.
Codex should read the live ApplyPilot queue, use the existing Chrome profile and autofill
extension, fill only missed fields from grounded candidate information, submit, record the
outcome, and continue. One failed job must not stop the batch.

## Phase 1 — foundation (implemented and live-tested in development)

- Repo-local plugin manifest, Apply jobs skill, and local stdio MCP server.
- Five least-privilege queue/context/lifecycle tools.
- Revocable, signed, user-bound two-hour run tokens with forced-RLS storage.
- One-click creation of the temporary local environment setup from Assign to AI.
- Existing copied twenty-row prompt retained as a fallback.
- Repo-local `personal` marketplace entry, locally installed as `applypilot@personal`.
- Live MCP smoke test against `applydev.vamsikrish.com`, including all five tools and a
  user-scoped queue read; the smoke credential was revoked afterward.

Exit gate met: manifest validation, MCP handshake, token/route tests, full app tests,
TypeScript, documentation check, build, deployed development APIs/migration, marketplace
installation, and authenticated live queue read.

## Phase 2 — remove setup friction

- Replace copied environment tokens with OAuth 2.1/device authorization suitable for a
  local Codex plugin.
- Show connected device/run sessions in ApplyPilot with one-click revoke and expiry.
- Let the plugin refresh its own narrow access without ever receiving the app password or
  backend credential.

Exit gate: a user installs/connects once, can revoke the connection, and no secret is
copied through chat, source control, logs, or plugin configuration.

## Phase 3 — reliable batch execution

- Add a short queue lease so two agent runs cannot work the same application at once.
- Add idempotency keys to lifecycle writes and recover stale `in_progress` rows safely.
- Record bounded step evidence: URL host, timestamps, outcome, and visible success marker;
  do not store page contents, browser credentials, or sensitive form answers.
- Evaluate Easy Apply and common external ATS flows with repeatable fixtures and measured
  completion/blocker rates.

Exit gate: interrupted/restarted runs resume without double submission, concurrent runs do
not collide, and reported Submitted always has visible-success evidence.

## Phase 4 — safer, smarter navigation

- Detect instructions embedded in job pages that attempt to redirect the agent away from
  the application workflow or request unrelated data/actions.
- Recognize authentication expiry, CAPTCHA, file-upload mismatch, and genuinely unknown
  required fields as Needs review while continuing the queue.
- Prefer extension output; call candidate-context tools only for still-empty fields.
- Add concise per-run summaries: submitted, needs review, skipped, and remaining.

Exit gate: adversarial and failure fixtures cannot cause fabricated answers, unrelated
actions, credential exposure, or false submission records.

## Phase 5 — package and release

- Add a reviewed repo/team marketplace entry and installation instructions.
- Version the plugin independently, document compatibility with ApplyPilot API versions,
  and add upgrade tests.
- Deploy first to development, run owner acceptance, then merge to `multi-user-fork` only
  after explicit approval.

The production branch, production backend, and installed personal Codex configuration
remain untouched until that release decision.
