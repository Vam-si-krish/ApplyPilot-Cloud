# DAY 49 — 2026-07-31

## ChatGPT-subscription mail-sync completion

Production worker logs showed individual ChatGPT-subscription mail classifications
completing successfully, while the signed-in Inbox reproduced a partially drained batch:
the UI reported eleven messages classified even though seven remained pending. Direct API
providers masked the defect because their eight sequential calls usually completed
inside the serverless request.

- Added provider-aware mail chunks: direct APIs retain eight messages per request, while
  either subscription provider runs one worker completion per request.
- Made the Inbox classify loop check the HTTP response and the actual remaining count.
  Interrupted requests now show a retryable pending count and cannot render a false Done
  state.
- Added regression coverage for ChatGPT/Claude subscription selection, direct API
  selection, and the complete-pair lane fallback.
- Added ADR 0116 and updated the product/architecture summaries for the observable
  completion contract.

The data owner remains the authenticated user's UUID. The caller is the signed-in browser
or the authorized cron route. Gmail OAuth tokens are read only by the existing
server-side boundary, and up to 30,000 transient body characters continue to reach only
the user's selected classification provider. Subscription prompts cross the authenticated
worker with the caller UUID and use only that UUID's isolated Claude/ChatGPT credential
directory. Classification results remain in forced-RLS `mail_messages` rows. The
deployment targets are the production Netlify site and isolated `com.jobpilotmulti.*`
worker/gateway services; ApplyPilot production resources remain out of scope.

Pre-deployment verification passed: 281 app tests passed (16 eval cases intentionally
skipped), backend passed 23/23, résumé-worker passed 23/23, TypeScript typecheck passed,
the optimized production build passed, documentation validation passed, and
`git diff --check` passed. The protected production database/file backup completed.
Deploy, service health, and a signed-in ChatGPT-subscription Inbox drain remain pending.
