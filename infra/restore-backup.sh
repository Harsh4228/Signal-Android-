#!/usr/bin/env bash
# Puts a backup made by backup-now.sh back on this server: database, attachments, .env, push keys, installers.
# Works on the same server (roll back) and on a NEW server (move). On a new server run setup-oracle.sh first.
#
# Normally run from your PC:  scripts\restore-server.ps1 -Backup <file.tgz>
# On the server:              bash ~/meetme/infra/restore-backup.sh <cellmate-backup.tgz>
#
# Safe by design:
#  - what is on this server now is dumped to infra/backups/before-restore-<time>.dump (+ .env copy) first
#  - this server's own PUBLIC_IP / PRIVATE_IP are kept (the rest of .env comes from the backup)
#  - the database restore is all-or-nothing (one transaction)
set -euo pipefail

SRC=${1:?usage: restore-backup.sh <cellmate-backup.tgz>}
SRC=$(readlink -f "$SRC")
[ -d "$HOME/meetme/infra" ] || { echo "No ~/meetme/infra here: run setup-oracle.sh on this server first"; exit 1; }
cd "$HOME/meetme/infra"
dc() { sudo docker compose "$@"; }
step() { printf '\n==> %s\n' "$*"; }
project() { local p=${COMPOSE_PROJECT_NAME:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null)}; echo "${p:-$(basename "$PWD")}"; }
wait_db() {
  for _ in $(seq 1 60); do dc exec -T db pg_isready -U meetme -d meetme >/dev/null 2>&1 && return 0; sleep 2; done
  echo "Database did not start: sudo docker compose logs db"; exit 1
}
TS=$(date +%Y-%m-%d_%H%M)

W=$(mktemp -d)
trap 'sudo rm -rf "$W"' EXIT
step "Opening the backup"
sudo tar xzf "$SRC" -C "$W"
for f in db.dump env; do [ -f "$W/$f" ] || { echo "Not a CellMate backup ($f missing)"; exit 1; }; done
sudo cat "$W/MANIFEST" 2>/dev/null || true
mkdir -p backups secrets updates

step "Safety copy of what is on this server now"
if [ -f .env ]; then cp .env ".env.before-restore-$TS"; echo "   .env.before-restore-$TS"; fi
if [ -n "$(dc ps -q --status running db 2>/dev/null)" ]; then
  n=$(dc exec -T db psql -U meetme -d meetme -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)
  if [ "${n:-0}" -gt 0 ]; then
    dc exec -T db pg_dump -U meetme -d meetme -Fc -f /tmp/before-restore.dump
    dc cp db:/tmp/before-restore.dump "backups/before-restore-$TS.dump"
    dc exec -T db rm -f /tmp/before-restore.dump
    echo "   backups/before-restore-$TS.dump"
  else
    echo "   database is empty - nothing to keep"
  fi
else
  echo "   database not running - nothing to keep"
fi

step "Stopping everything"
dc stop

step "Settings (.env from the backup, this server's own IP addresses)"
PUB=$(sed -n 's/^PUBLIC_IP=//p' .env 2>/dev/null || true)
PRIV=$(sed -n 's/^PRIVATE_IP=//p' .env 2>/dev/null || true)
PUB=${PUB:-$(curl -fsS https://api.ipify.org || true)}
PRIV=${PRIV:-$(hostname -I | awk '{print $1}')}
sudo cp "$W/env" .env
sudo chown "$(id -u):$(id -g)" .env
chmod 600 .env
[ -n "$PUB" ] && sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$PUB|" .env
[ -n "$PRIV" ] && sed -i "s|^PRIVATE_IP=.*|PRIVATE_IP=$PRIV|" .env
echo "   PUBLIC_IP=$PUB  PRIVATE_IP=$PRIV  $(grep '^DOMAIN=' .env)"
if [ -d "$W/secrets" ]; then sudo cp -a "$W/secrets/." secrets/; echo "   push keys: $(ls secrets | tr '\n' ' ')"; fi
if [ -d "$W/updates" ]; then sudo cp -a "$W/updates/." updates/; echo "   desktop installers copied"; fi

step "Database"
dc up -d db
wait_db
# The database volume keeps the password it was first created with: make it match the restored .env.
PW=$(sed -n 's/^POSTGRES_PASSWORD=//p' .env)
printf '%s\n' "ALTER USER meetme PASSWORD :'pw';" | dc exec -T db psql -q -U meetme -d postgres -v ON_ERROR_STOP=1 -v pw="$PW"
dc exec -T db psql -q -U meetme -d meetme -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
dc cp "$W/db.dump" db:/tmp/restore.dump
dc exec -T db pg_restore -U meetme -d meetme --no-owner --single-transaction --exit-on-error /tmp/restore.dump
dc exec -T db rm -f /tmp/restore.dump
users=$(dc exec -T db psql -U meetme -d meetme -tAc 'select count(*) from users')
echo "   restored: $users users"

step "Attachments (photos, files)"
if [ -f "$W/data.tgz" ]; then
  P=$(project)
  VOL=$(sudo docker volume ls -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.volume=meetme-data" | head -1)
  if [ -z "$VOL" ]; then
    VOL="${P}_meetme-data"
    sudo docker volume create --label "com.docker.compose.project=$P" --label com.docker.compose.volume=meetme-data "$VOL" >/dev/null
  fi
  sudo docker run --rm -v "$VOL":/data -v "$W":/in:ro alpine sh -c 'find /data -mindepth 1 -delete && tar xzpf /in/data.tgz --numeric-owner -C /data'
  echo "   $(sudo docker run --rm -v "$VOL":/data:ro alpine sh -c 'find /data -type f | wc -l') files"
else
  echo "   backup has no attachments - left as they are"
fi

step "Starting CellMate (may build for a few minutes)"
dc up -d --build
sleep 5
dc ps
dc logs --tail 10 server
echo
echo "Done. Old data kept in: backups/before-restore-$TS.dump and .env.before-restore-$TS"
