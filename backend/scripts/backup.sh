#!/bin/zsh
set -euo pipefail
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$BACKEND/logs/backup.log"
mkdir -p "$BACKEND/logs" "$BACKEND/backups"
set -a; source "$BACKEND/.env"; set +a
STAMP=$(date '+%Y%m%d-%H%M')

docker exec applypilot-db pg_dump -U postgres -d "$DB_NAME" | gzip > "$BACKEND/backups/db-$STAMP.sql.gz"
if [[ -d "$BACKEND/data" ]]; then
  tar -czf "$BACKEND/backups/files-$STAMP.tar.gz" -C "$BACKEND" data
fi
find "$BACKEND/backups" -type f -mtime +14 -delete
echo "$(date '+%F %T') backup complete" >> "$LOG"
