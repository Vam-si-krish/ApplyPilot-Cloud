#!/bin/zsh
# Phase 3: copy every object in the cloud 'resumes' bucket into the local
# stack's storage. Requires the CLOUD project's API to be unblocked (egress
# restriction lifted) — files can only leave through the Storage API.
#
# Usage:
#   CLOUD_URL=https://ftrakpebzcabztwyunum.supabase.co \
#   CLOUD_SERVICE_KEY='eyJ...' ./scripts/sync-storage-files.sh
set -euo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
: "${CLOUD_URL:?set CLOUD_URL to the cloud Supabase URL}"
: "${CLOUD_SERVICE_KEY:?set CLOUD_SERVICE_KEY to the cloud service_role key}"
BUCKET="${BUCKET:-resumes}"

LOCAL_KEY=$(grep -E '^SERVICE_ROLE_KEY=' "$SH/.env" | cut -d= -f2-)
KONG_PORT=$(grep -E '^KONG_HTTP_PORT=' "$SH/.env" | cut -d= -f2-); KONG_PORT=${KONG_PORT:-8000}
LOCAL_URL="http://127.0.0.1:$KONG_PORT"

list_page() { # $1 = offset
  curl -fsS -X POST "$CLOUD_URL/storage/v1/object/list/$BUCKET" \
    -H "Authorization: Bearer $CLOUD_SERVICE_KEY" -H "apikey: $CLOUD_SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"prefix\":\"\",\"limit\":100,\"offset\":$1,\"sortBy\":{\"column\":\"name\",\"order\":\"asc\"}}"
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
OFFSET=0; TOTAL=0; FAILED=0

while :; do
  PAGE=$(list_page $OFFSET)
  COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).length)" "$PAGE")
  [[ "$COUNT" -eq 0 ]] && break
  node -e "JSON.parse(process.argv[1]).forEach(o => o.id && console.log(o.name))" "$PAGE" | while IFS= read -r NAME; do
    mkdir -p "$TMP/$(dirname "$NAME")"
    if curl -fsS -m 120 "$CLOUD_URL/storage/v1/object/$BUCKET/$NAME" \
         -H "Authorization: Bearer $CLOUD_SERVICE_KEY" -H "apikey: $CLOUD_SERVICE_KEY" \
         -o "$TMP/$NAME"; then
      CT=$(file -b --mime-type "$TMP/$NAME" 2>/dev/null || echo application/octet-stream)
      curl -fsS -X POST "$LOCAL_URL/storage/v1/object/$BUCKET/$NAME" \
        -H "Authorization: Bearer $LOCAL_KEY" -H "apikey: $LOCAL_KEY" \
        -H "Content-Type: $CT" -H "x-upsert: true" \
        --data-binary "@$TMP/$NAME" > /dev/null && echo "synced $NAME" || { echo "UPLOAD FAILED $NAME"; FAILED=$((FAILED+1)); }
      rm -f "$TMP/$NAME"
    else
      echo "DOWNLOAD FAILED $NAME"; FAILED=$((FAILED+1))
    fi
    TOTAL=$((TOTAL+1))
  done
  OFFSET=$((OFFSET+COUNT))
done

echo "done: $OFFSET listed, failures: $FAILED"
[[ $FAILED -eq 0 ]]
