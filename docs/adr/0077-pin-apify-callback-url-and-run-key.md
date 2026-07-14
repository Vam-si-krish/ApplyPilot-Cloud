# ADR 0077 — Validate Apify callbacks and pin the launching key

**Status:** accepted · **Date:** 2026-07-14 · **Builds on:** ADRs 0004, 0006, 0007,
0059, and 0073

## Context

Pilot 2 started three valid LinkedIn actor runs. Apify completed them, but the app left
all three internal runs at `running` with zero jobs. Apify dispatch evidence showed every
callback targeted the deployment template `https://your-new-site.netlify.app`, returning
404 on every retry. `NEXT_PUBLIC_APP_URL` had therefore overridden Netlify's injected,
real `URL` with a placeholder.

Pilot 2 also had two Apify keys. Datasets belong to the Apify account that launched the
run, but webhook ingestion previously read whichever key happened to be active later.
Rotation or a user switch during the run could make a valid private dataset return 403.
The single-key production account did not expose this second failure mode.

## Decision

- Ignore the documented placeholder when resolving the application base URL and fall
  back to Netlify's runtime `URL` (or Vercel's runtime URL).
- Before rotating keys or starting a billable actor, require a public HTTPS callback.
  Localhost, malformed, and placeholder-only configurations fail visibly.
- Store `runs.apify_api_key_id` and make it a same-user composite foreign key to
  `api_keys`. Every started run records the exact vault row used.
- Fetch run metadata and dataset items with that pinned credential. Legacy rows without
  a key ID retain the active-key fallback.

## Consequences

- A template environment value can no longer create paid but permanently stuck runs.
- Switching or rotating Apify keys while an actor runs cannot break its callback.
- Deleting the launching key before completion clears the reference; a later callback
  may require operator recovery because the private dataset credential is gone.
- The configured Netlify value should still be corrected to the real site URL; runtime
  fallback is a safety net, not a reason to keep template configuration.

## Verification

1. URL tests prove the placeholder yields to Netlify `URL` and local-only callbacks fail.
2. Credential tests preserve the active vault row ID alongside its secret.
3. Fresh/live migration verifies the same-user foreign key.
4. Recover Pilot 2's latest completed dataset with its original key without a new scrape.
5. Full app/backend/worker tests, typecheck, build, docs check, public health, and a future
   real callback complete successfully.
