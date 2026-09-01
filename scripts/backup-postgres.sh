#!/bin/sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL before running a backup.}"
FILE_STORAGE_DIR=${FILE_STORAGE_DIR:-./data/files}
BACKUP_ROOT=${BACKUP_ROOT:-./backups}
APP_SERVICE=${APP_SERVICE:-}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

mkdir -p "$BACKUP_DIR/files"
APP_STOPPED=false
restart_app() {
  if [ "$APP_STOPPED" = true ]; then
    systemctl start "$APP_SERVICE"
  fi
}

if [ -n "$APP_SERVICE" ] && systemctl is-active --quiet "$APP_SERVICE"; then
  systemctl stop "$APP_SERVICE"
  APP_STOPPED=true
  trap restart_app EXIT INT TERM
fi

pg_dump --dbname="$DATABASE_URL" --format=custom --file="$BACKUP_DIR/postgres.dump"

if [ -d "$FILE_STORAGE_DIR" ]; then
  cp -a "$FILE_STORAGE_DIR/." "$BACKUP_DIR/files/"
fi

(cd "$BACKUP_DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
restart_app
APP_STOPPED=false
trap - EXIT INT TERM
echo "Backup created: $BACKUP_DIR"
