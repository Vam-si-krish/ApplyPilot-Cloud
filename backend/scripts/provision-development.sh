#!/bin/zsh
set -euo pipefail

[[ $# -eq 1 && "$1" =~ '^[0-9a-f]{7,40}$' ]] || { echo "Usage: $0 <develop-commit>" >&2; exit 64; }
EXPECTED="$1"
CONTROL_BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_REPO="$(cd "$CONTROL_BACKEND/.." && pwd)"
DEV_REPO="${JOBPILOT_DEVELOPMENT_REPO:-/Users/vamsikrish/apps/jobpilot-multi-dev}"
DEV_BACKEND="$DEV_REPO/backend"
DEV_URL="https://develop--willowy-dieffenbachia-21307c.netlify.app"
PUBLIC_URL="https://vamsis-macbook-pro.tail579e6c.ts.net/jobpilot-dev"

health_wait() {
  local url="$1"
  local attempt
  for attempt in {1..30}; do
    curl -fsS -m 8 "$url" && return 0
    sleep 1
  done
  return 1
}

ORIGIN=$(git -C "$PRODUCTION_REPO" remote get-url origin)
if [[ ! -d "$DEV_REPO/.git" ]]; then
  git clone --branch develop --single-branch "$ORIGIN" "$DEV_REPO"
else
  [[ -z "$(git -C "$DEV_REPO" status --porcelain)" ]] || { echo "Development checkout is dirty" >&2; exit 1; }
  git -C "$DEV_REPO" fetch origin develop --quiet
  git -C "$DEV_REPO" merge --ff-only origin/develop --quiet
fi
ACTUAL=$(git -C "$DEV_REPO" rev-parse HEAD)
[[ "$ACTUAL" == "$EXPECTED"* ]] || { echo "Development checkout is at ${ACTUAL[1,7]}, expected $EXPECTED" >&2; exit 1; }

if [[ ! -f "$DEV_BACKEND/.env" ]]; then
  for port in 8241 8242 8243; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Development port $port is already in use" >&2
      exit 1
    fi
  done

  DB_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)
  WORKER_SECRET=$(openssl rand -hex 32)
  AUTH_SECRET=$(openssl rand -hex 32)
  CRON_SECRET=$(openssl rand -hex 32)
  VAMSI_PASSWORD=$(openssl rand -hex 12)
  SURYA_PASSWORD=$(openssl rand -hex 12)
  SAMITHA_PASSWORD=$(openssl rand -hex 12)
  DB_ROLE=jobpilot_multi_dev_app
  SERVICE_ROLE_KEY=$(print -rn -- "$JWT_SECRET" | DB_ROLE="$DB_ROLE" node "$DEV_BACKEND/generate-service-key.mjs")
  APP_USERS_JSON="[{\"id\":\"00000000-0000-4000-8000-000000000001\",\"username\":\"vamsi\",\"displayName\":\"Vamsi Dev\",\"password\":\"$VAMSI_PASSWORD\"},{\"id\":\"00000000-0000-4000-8000-000000000002\",\"username\":\"surya\",\"displayName\":\"Surya Dev\",\"password\":\"$SURYA_PASSWORD\"},{\"id\":\"00000000-0000-4000-8000-000000000003\",\"username\":\"samitha\",\"displayName\":\"Samitha Dev\",\"password\":\"$SAMITHA_PASSWORD\"}]"

  umask 077
  cat > "$DEV_BACKEND/.env" <<EOF
APP_NAME=jobpilotdev
APP_PATH=jobpilot-dev
BRANCH=develop
PORT=8241
POSTGREST_PORT=8242
WORKER_PORT=8243
DB_NAME=jobpilot_multi_dev
DB_ROLE=$DB_ROLE
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://$DB_ROLE:$DB_PASSWORD@127.0.0.1:54322/jobpilot_multi_dev
POSTGREST_DATABASE_URL=postgresql://$DB_ROLE:$DB_PASSWORD@host.docker.internal:54322/jobpilot_multi_dev
JWT_SECRET=$JWT_SECRET
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
STORAGE_SIGNING_SECRET=$STORAGE_SIGNING_SECRET
WORKER_SECRET=$WORKER_SECRET
REST_TARGET=http://127.0.0.1:8242
WORKER_TARGET=http://127.0.0.1:8243
PUBLIC_URL=$PUBLIC_URL
CORS_ORIGINS=$DEV_URL
EOF
  cat > "$DEV_REPO/.env.local" <<EOF
BACKEND_URL=$PUBLIC_URL
BACKEND_SERVICE_KEY=$SERVICE_ROLE_KEY
RESUME_WORKER_URL=$PUBLIC_URL/worker
RESUME_WORKER_SECRET=$WORKER_SECRET
APP_USERS_JSON=$APP_USERS_JSON
AUTH_SECRET=$AUTH_SECRET
CRON_SECRET=$CRON_SECRET
NEXT_PUBLIC_APP_URL=$DEV_URL
ONBOARDING_SUBSCRIPTION_PROVIDER=chatgpt_subscription
ONBOARDING_SUBSCRIPTION_MODEL=gpt-5.4
DEPLOYMENT_ENV=development
EOF
  chmod 600 "$DEV_BACKEND/.env" "$DEV_REPO/.env.local"
fi

set -a; source "$DEV_BACKEND/.env"; set +a
docker inspect applypilot-db >/dev/null
docker exec -i applypilot-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v role="$DB_ROLE" -v pass="$DB_PASSWORD" -v db="$DB_NAME" <<'SQL'
select format('create role %I login password %L', :'role', :'pass')
where not exists (select 1 from pg_roles where rolname = :'role') \gexec
select format('alter role %I login password %L', :'role', :'pass') \gexec
select format('grant %I to %I', :'role', current_user) \gexec
select format('create database %I owner %I', :'db', :'role')
where not exists (select 1 from pg_database where datname = :'db') \gexec
select format('revoke %I from %I', :'role', current_user) \gexec
SQL

npm ci --prefix "$DEV_BACKEND"
npm install --prefix "$DEV_REPO/resume-worker"
node "$DEV_BACKEND/migrate.mjs"
docker compose --project-name "$APP_NAME" --project-directory "$DEV_BACKEND" --env-file "$DEV_BACKEND/.env" up -d
chmod +x "$DEV_BACKEND"/scripts/*.sh
"$DEV_BACKEND/scripts/install-launchd.sh"
tailscale funnel --bg --set-path "/${APP_PATH}" "http://127.0.0.1:${PORT}"
health_wait "http://127.0.0.1:${PORT}/health"
health_wait "$PUBLIC_URL/health"
print
print -- "development=ready commit=${ACTUAL[1,7]}"
