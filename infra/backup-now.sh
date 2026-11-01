#!/usr/bin/env bash
# Makes ONE file with everything CellMate needs to come back on any server:
#   db.dump    - the whole database (accounts, keys, queued messages)
#   data.tgz   - the server's data volume (photos, files = attachments)
#   env        - infra/.env (passwords, TURN secret, domain, ...)
#   secrets/   - push keys (fcm-service-account.json, apns.p8)
#   updates/   - desktop app installers
#   MANIFEST   - when, where, how many users
#
# Normally run from your PC:  scripts\backup-server.ps1
# On the server:              bash ~/meetme/infra/backup-now.sh [--stop] [output.tgz]
#   --stop  stops the app first so nothing changes during the copy. Use it right before moving to a new
#           server. The app STAYS stopped afterwards, so no new messages land on the old server.
set -euo pipefail

STOP=0
if [ "${1:-}" = "--stop" ]; then STOP=1; shift; fi
OUT=${1:-$HOME/cellmate-backup-$(date +%Y-%m-%d_%H%M).tgz}

cd "$HOME/meetme/infra"
dc() { sudo docker compose "$@"; }
step() { printf '\n==> %s\n' "$*"; }
project() { local p=${COMPOSE_PROJECT_NAME:-$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env 2>/dev/null)}; echo "${p:-$(basename "$PWD")}"; }
P=$(project)
VOL=$(sudo docker volume ls -q --filter "label=com.docker.compose.project=$P" --filter "label=com.docker.compose.volume=meetme-data" | head -1)

W=$(mktemp -d)
trap 'sudo rm -rf "$W"' EXIT

if [ $STOP = 1 ]; then
  step "Stopping the app (the database keeps running for the copy)"
  dc stop server caddy
fi

step "Database"
dc exec -T db pg_dump -U meetme -d meetme -Fc -f /tmp/cellmate-backup.dump
tables=$(dc exec -T db sh -c "pg_restore -l /tmp/cellmate-backup.dump | grep -c ' TABLE DATA '" || echo 0)
users=$(dc exec -T db psql -U meetme -d meetme -tAc 'select count(*) from users' 2>/dev/null || echo '?')
dc cp db:/tmp/cellmate-backup.dump "$W/db.dump"
dc exec -T db rm -f /tmp/cellmate-backup.dump
if [ "${tables:-0}" -eq 0 ]; then echo "STOP: the database dump has no table data - nothing was saved"; exit 1; fi
echo "   $tables tables, $users users"

step "Attachments (photos, files)"
if [ -n "$VOL" ]; then
  sudo docker run --rm -v "$VOL":/data:ro -v "$W":/out alpine tar czf /out/data.tgz --numeric-owner -C /data .
  echo "   $(sudo du -h "$W/data.tgz" | cut -f1)"
else
  echo "   WARNING: data volume not found - backup has NO attachments"
fi

step "Settings, push keys, desktop installers"
sudo cp .env "$W/env"
[ -d secrets ] && sudo cp -a secrets "$W/secrets"
[ -d updates ] && sudo cp -a updates "$W/updates"

cat <<EOF | sudo tee "$W/MANIFEST" >/dev/null
CellMate backup
made:     $(date -Is)
server:   $(hostname) ($(hostname -I | awk '{print $1}'))
code:     $(git -C "$HOME/meetme" rev-parse --short HEAD 2>/dev/null || echo '?')
users:    $users
tables:   $tables
app was stopped for the copy: $([ $STOP = 1 ] && echo yes || echo no)
EOF

step "Packing"
sudo tar czf "$OUT" -C "$W" .
sudo chown "$(id -u):$(id -g)" "$OUT"
chmod 600 "$OUT"
echo "   $OUT ($(du -h "$OUT" | cut -f1))"

if [ $STOP = 1 ]; then
  echo
  echo "The app is STOPPED on this server. To start it again:  cd ~/meetme/infra && sudo docker compose up -d"
fi
