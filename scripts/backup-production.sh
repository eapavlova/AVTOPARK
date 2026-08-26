#!/bin/sh
set -eu

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.production.yml}
ENV_FILE=${ENV_FILE:-.env.production}
BACKUP_ROOT=${BACKUP_ROOT:-./backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mkdir -p "$BACKUP_DIR/files"
APP_STOPPED=false
restart_app() {
  if [ "$APP_STOPPED" = true ]; then
    compose start app >/dev/null
  fi
}
trap restart_app EXIT INT TERM

compose stop app >/dev/null
APP_STOPPED=true
compose exec -T postgres sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "$BACKUP_DIR/postgres.dump"
compose cp app:/app/data/files/. "$BACKUP_DIR/files"

(cd "$BACKUP_DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
compose start app >/dev/null
APP_STOPPED=false
trap - EXIT INT TERM

echo "Backup created: $BACKUP_DIR"
