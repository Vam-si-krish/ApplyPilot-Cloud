#!/bin/zsh
# Nightly backup: runs at 03:30 via launchd (com.applypilot.selfhost.backup).
# - pg_dump of the public schema (runs INSIDE the db container: always version-matched)
# - rsync mirror of storage files (the resumes bucket PDFs)
# - copies to a second location (iCloud Drive by default, if present)
# - 14-day retention, healthchecks.io ping on success — a backup that stops
#   happening triggers an alert, not silence.
set -euo pipefail

SH="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$SH/logs/backup.log"
mkdir -p "$SH/logs" "$SH/backups"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

STAMP=$(date '+%Y%m%d-%H%M')
OUT="$SH/backups/db-$STAMP.sql.gz"

cd "$SH"
docker compose exec -T db pg_dump -U postgres -d postgres -n public | gzip > "$OUT"
SIZE=$(du -h "$OUT" | cut -f1)
log "db dump $OUT ($SIZE)"

# storage files mirror. The files live in a named Docker volume (xattr support),
# so stream them out via tar, then rsync into the mirror so deletions propagate.
rm -rf "$SH/backups/.storage-tmp"
mkdir -p "$SH/backups/.storage-tmp" "$SH/backups/storage-mirror"
if docker compose exec -T storage tar -cf - -C /var/lib/storage . 2>>"$LOG" | tar -xf - -C "$SH/backups/.storage-tmp" 2>>"$LOG"; then
  rsync -a --delete "$SH/backups/.storage-tmp/" "$SH/backups/storage-mirror/" 2>>"$LOG" || true
fi
rm -rf "$SH/backups/.storage-tmp"

# second destination: explicit BACKUP_DEST2, else iCloud Drive if available
DEST2=$(grep -E '^BACKUP_DEST2=' "$SH/.env" 2>/dev/null | cut -d= -f2-)
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
if [[ -z "${DEST2:-}" && -d "$ICLOUD" ]]; then DEST2="$ICLOUD/ApplyPilotBackups"; fi
if [[ -n "${DEST2:-}" ]]; then
  mkdir -p "$DEST2"
  cp "$OUT" "$DEST2/"
  # weekly (Sunday) full snapshot of storage files to the second location
  if [[ $(date +%u) -eq 7 ]]; then
    tar -czf "$DEST2/storage-$STAMP.tar.gz" -C "$SH/backups" storage-mirror 2>>"$LOG" || true
  fi
  find "$DEST2" -name 'db-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
  find "$DEST2" -name 'storage-*.tar.gz' -mtime +35 -delete 2>/dev/null || true
  log "copied to $DEST2"
fi

find "$SH/backups" -name 'db-*.sql.gz' -mtime +14 -delete 2>/dev/null || true

HC=$(grep -E '^HC_PING_BACKUP=' "$SH/.env" 2>/dev/null | cut -d= -f2-)
[[ -n "${HC:-}" ]] && curl -fsS -m 10 "$HC" >/dev/null 2>&1 || true
log "backup complete"
