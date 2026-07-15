#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$BACKEND/.." && pwd)"

if [[ "$REPO" == *"/Desktop/projects/ApplyPilot-Cloud" ]]; then
  echo "Refusing to install in the production ApplyPilot checkout. Clone multi-user-fork to ~/apps/jobpilot-multi first."
  exit 1
fi
command -v docker >/dev/null
command -v tailscale >/dev/null
docker inspect applypilot-db >/dev/null

if [[ ! -f "$BACKEND/.env" ]]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  STORAGE_SIGNING_SECRET=$(openssl rand -hex 32)
  WORKER_SECRET=$(openssl rand -hex 32)
  DB_ROLE=jobpilot_multi_app
  SERVICE_ROLE_KEY=$(print -rn -- "$JWT_SECRET" | DB_ROLE="$DB_ROLE" node "$BACKEND/generate-service-key.mjs")
  umask 077
  cat > "$BACKEND/.env" <<EOF
APP_NAME=jobpilotmulti
APP_PATH=jobpilot
BRANCH=multi-user-fork
PORT=8231
POSTGREST_PORT=8232
WORKER_PORT=8233
DB_NAME=jobpilot_multi
DB_ROLE=$DB_ROLE
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://$DB_ROLE:$DB_PASSWORD@127.0.0.1:54322/jobpilot_multi
POSTGREST_DATABASE_URL=postgresql://$DB_ROLE:$DB_PASSWORD@host.docker.internal:54322/jobpilot_multi
JWT_SECRET=$JWT_SECRET
SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
STORAGE_SIGNING_SECRET=$STORAGE_SIGNING_SECRET
WORKER_SECRET=$WORKER_SECRET
REST_TARGET=http://127.0.0.1:8232
WORKER_TARGET=http://127.0.0.1:8233
PUBLIC_URL=https://vamsis-macbook-pro.tail579e6c.ts.net/jobpilot
CORS_ORIGINS=https://your-new-site.netlify.app
EOF
fi

set -a; source "$BACKEND/.env"; set +a
docker exec -i applypilot-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v role="$DB_ROLE" -v pass="$DB_PASSWORD" -v db="$DB_NAME" <<'SQL'
select format('create role %I login password %L', :'role', :'pass')
where not exists (select 1 from pg_roles where rolname = :'role') \gexec
select format('alter role %I login password %L', :'role', :'pass') \gexec
select format('create database %I owner %I', :'db', :'role')
where not exists (select 1 from pg_database where datname = :'db') \gexec
SQL

npm ci --prefix "$BACKEND"
npm install --prefix "$REPO/resume-worker"
node "$BACKEND/migrate.mjs"
docker compose --project-name "$APP_NAME" --project-directory "$BACKEND" --env-file "$BACKEND/.env" up -d
chmod +x "$BACKEND"/scripts/*.sh
"$BACKEND/scripts/install-launchd.sh"
tailscale funnel --bg --set-path "/${APP_PATH}" "http://127.0.0.1:${PORT}"
curl -fsS "http://127.0.0.1:${PORT}/health"
curl -fsS "$PUBLIC_URL/health"
echo
echo "Backend installed. Netlify values are stored in $BACKEND/.env (never commit that file)."
