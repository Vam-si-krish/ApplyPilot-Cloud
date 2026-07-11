#!/bin/zsh
# One-shot migration of the cloud Supabase DB into the local stack.
# Dumps ONLY the public schema (all app data lives there) over a direct
# Postgres connection — this works even while the cloud project's REST API
# is egress-restricted. Storage FILES are synced separately (see
# sync-storage-files.sh) because they can only leave through the Storage API.
#
# Usage:
#   CLOUD_PGPASSWORD='...' ./scripts/restore-from-cloud.sh
#   (optional: CLOUD_HOST=db.xxx.supabase.co, defaults to the ApplyPilot project)
set -euo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
CLOUD_HOST="${CLOUD_HOST:-db.ftrakpebzcabztwyunum.supabase.co}"
: "${CLOUD_PGPASSWORD:?set CLOUD_PGPASSWORD to the cloud DB password}"

STAMP=$(date '+%Y%m%d-%H%M')
DUMP="$SH/backups/cloud-public-$STAMP.sql"
mkdir -p "$SH/backups"

echo "==> dumping public schema from $CLOUD_HOST ..."
PGPASSWORD="$CLOUD_PGPASSWORD" PGCONNECT_TIMEOUT=15 pg_dump \
  -h "$CLOUD_HOST" -p 5432 -U postgres -d postgres \
  --schema=public --no-owner --no-privileges --clean --if-exists \
  > "$DUMP"
echo "    $(du -h "$DUMP" | cut -f1) -> $DUMP"

echo "==> restoring into local stack ..."
cd "$SH"
docker compose exec -T db psql -U postgres -d postgres -q < "$DUMP" > /dev/null

echo "==> granting API roles on public schema (idempotent) ..."
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
-- mark every shipped migration as applied (the dump already contains their results)
create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now());
SQL

for f in "$SH"/../supabase/migrations/*.sql(N); do
  base=$(basename "$f")
  docker compose exec -T db psql -U postgres -d postgres -q \
    -c "insert into public.schema_migrations (filename) values ('$base') on conflict do nothing;"
done

echo "==> creating 'resumes' bucket via storage API ..."
SERVICE_ROLE_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$SH/.env" | cut -d= -f2-)
KONG_PORT=$(grep -E '^KONG_HTTP_PORT=' "$SH/.env" | cut -d= -f2-); KONG_PORT=${KONG_PORT:-8000}
HTTP=$(curl -s -o /tmp/bucket-resp.json -w '%{http_code}' -X POST "http://127.0.0.1:$KONG_PORT/storage/v1/bucket" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"resumes","name":"resumes","public":false}')
if [[ "$HTTP" == "200" || "$HTTP" == "409" ]]; then
  echo "    bucket ok (HTTP $HTTP)"
else
  echo "    bucket creation returned HTTP $HTTP: $(cat /tmp/bucket-resp.json)"; exit 1
fi

echo "==> done. Row counts:"
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select 'jobs='||count(*) from jobs; select 'applications='||count(*) from applications; select 'settings='||count(*) from settings; select 'profile='||count(*) from profile;"
