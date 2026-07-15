# ADR 0094: Extension-owned autofill with unattended AI navigation

- Status: accepted
- Date: 2026-07-15
- Amends: ADR 0093 supervised external-application handoff

## Context

ADR 0093 assumed the browser agent might fill application answers and therefore required
an immediate user review before Submit. The owner clarified that an already-installed
autofill extension owns form completion from the résumé and its configured answers. The
AI should not compose or edit answers. Its job is mechanical navigation: wait for
autofill, invoke autofill again when needed, click Next through each page, click Submit,
verify visible success, and continue. A problem should not stop the batch.

## Decision

- The user starts one bounded Chrome run for no more than five assigned applications.
  That invocation authorizes navigation and submission for the batch; no per-application
  review or confirmation pause is required.
- The installed extension is the sole owner of form answer values. The browser agent may
  wait for or invoke its autofill function, but must not type, rewrite, infer, or
  overwrite answers.
- The active lifecycle is `assigned → in_progress → submitted`. The legacy
  `ready_to_submit` state remains readable and may transition to `submitted` so an
  in-flight ADR-0093 row is never stranded, but the UI no longer creates that state.
- Submission is recorded only after the employer site visibly displays success. The API
  no longer requires `confirmed: true`; it requires an in-progress or legacy-ready row.
- An unfilled required field after an autofill retry, CAPTCHA, login, closed posting,
  suspicious page instruction, or site error becomes `blocked` with a reason and moves
  to Set Aside. The browser tab stays open and the batch continues.
- LinkedIn/Easy Apply remains excluded. The app still does not store browser credentials,
  page contents, extension data, or form answers.

## Consequences

- The handoff matches the actual responsibility split and runs faster without a redundant
  review gate.
- The AI never becomes a second form-filling source, reducing conflicting or invented
  answers.
- Starting the bounded Chrome prompt is the user's consequential authorization. Visible
  success, rather than a confirmation dialog, remains the evidence for applied status.
- Native one-click browser execution from ApplyPilot remains future work; Phase 1 is a
  copyable user-invoked Chrome run backed by the existing durable queue.

## Verification

- Unit-test direct `in_progress → submitted`, legacy-ready compatibility, blocker flow,
  and prompt requirements for extension-only answers, no confirmation pause, visible
  success, and continued processing.
- Verify the route rejects submission from an unstarted row without accepting or
  requiring a confirmation flag.
- Run application/backend/worker tests, TypeScript, docs validation, build, and the
  isolated development deployment.
