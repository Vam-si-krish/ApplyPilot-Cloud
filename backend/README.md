# Independent server-laptop backend

This directory turns the `multi-user-fork` branch into a new application with no
dependency on Supabase and no access to the existing ApplyPilot production data.
The architecture decision and phase boundary are recorded in
[ADR 0072](../docs/adr/0072-independent-multi-user-fork-foundation.md).

Phase 2A supports three fixed accounts with forced RLS ownership and user-namespaced files.
Public signup remains deferred; credentials are configured only in Netlify.

## Isolation

- Database: `jobpilot_multi`, owned by `jobpilot_multi_app`, in the shared PostgreSQL
  cluster on `127.0.0.1:54322`.
- API gateway: `127.0.0.1:8231`.
- Database REST service: `127.0.0.1:8232`.
- Resume worker: `127.0.0.1:8233`.
- Public API: `https://vamsis-macbook-pro.tail579e6c.ts.net/jobpilot`.
- Files: `backend/data/` in the independent server checkout.
- Services: `com.jobpilotmulti.*`; production `com.applypilot.*` jobs are untouched.

The gateway implements only the REST and storage protocol used by this app. The
`@supabase/supabase-js` package remains temporarily as a protocol client; there is no
Supabase project or Supabase backend behind it.

## Install on the server laptop

```bash
mkdir -p ~/apps
git clone --branch multi-user-fork --single-branch \
  https://github.com/Vam-si-krish/ApplyPilot-Cloud.git ~/apps/jobpilot-multi
cd ~/apps/jobpilot-multi
./backend/scripts/bootstrap.sh
```

The bootstrap creates random credentials in `backend/.env`, creates only the new
database/role, applies migrations, installs the isolated services, mounts the Funnel
path, and verifies local and public health endpoints.

## Netlify variables

Set these on the new Netlify site. Secrets are copied from the server laptop's
`~/apps/jobpilot-multi/backend/.env`; never copy the production Netlify values.

```text
BACKEND_URL=<PUBLIC_URL>
BACKEND_SERVICE_KEY=<SERVICE_ROLE_KEY>
RESUME_WORKER_URL=<PUBLIC_URL>/worker
RESUME_WORKER_SECRET=<WORKER_SECRET>
APP_USERS_JSON=<three fixed account objects matching migration 0044 UUIDs>
AUTH_SECRET=<new random value>
CRON_SECRET=<new random value>
NEXT_PUBLIC_APP_URL=<new Netlify/custom-domain URL>
ONBOARDING_SUBSCRIPTION_PROVIDER=chatgpt_subscription
ONBOARDING_SUBSCRIPTION_MODEL=gpt-5.4
```

Apify and LLM keys can be added through the existing Settings UI after login. The new
database starts empty and does not inherit any production profile, job, Gmail, résumé,
or API-key records.

After the Netlify URL is known, replace `CORS_ORIGINS` in `backend/.env` and restart
`com.jobpilotmulti.backend`. Server-side Netlify calls do not require CORS, but keeping
the origin accurate is useful for later browser-facing Phase 2 endpoints.
