#!/usr/bin/env bash
# One-time setup of a fresh Oracle Cloud Ubuntu server for CellMate. Safe to run again.
#
# From your PC:
#   scp infra/setup-oracle.sh ubuntu@<PUBLIC_IP>:
#   scp fcm-service-account.json ubuntu@<PUBLIC_IP>:        (optional: push notifications)
#   ssh -t ubuntu@<PUBLIC_IP> 'bash setup-oracle.sh <domain> <admin-username> <public-ip>'
#
# It opens the firewall, installs Docker and security updates, downloads the code with a read-only GitHub
# deploy key, writes infra/.env with fresh random secrets (never overwrites an existing one) and starts everything.
set -euo pipefail

DOMAIN=${1:?usage: setup-oracle.sh <domain> <admin-username> <public-ip>}
ADMIN=${2:?usage: setup-oracle.sh <domain> <admin-username> <public-ip>}
PUBLIC_IP=${3:?usage: setup-oracle.sh <domain> <admin-username> <public-ip>}
REPO=git@github.com:Harsh4228/Signal-Android-.git
DIR=$HOME/meetme
step() { printf '\n==> %s\n' "$*"; }

step "Firewall: open 80, 443, 3478 and the TURN relay ports"
open() { sudo iptables -C INPUT "$@" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT "$@" -j ACCEPT; }
open -p tcp -m multiport --dports 80,443,3478
open -p udp --dport 3478
open -p udp --dport 49160:49400
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent unattended-upgrades git curl >/dev/null
sudo netfilter-persistent save >/dev/null

step "Automatic security updates"
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

step "Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
sudo usermod -aG docker "$USER"

step "Code (read-only GitHub deploy key)"
KEY=$HOME/.ssh/github_meetme
if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "meetme-server-deploy" -f "$KEY"
fi
if ! grep -q 'Host github.com' "$HOME/.ssh/config" 2>/dev/null; then
  printf 'Host github.com\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config"
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$HOME/.ssh/known_hosts"
until git ls-remote "$REPO" >/dev/null 2>&1; do
  echo
  echo "Add this key on GitHub: github.com/Harsh4228/Signal-Android- -> Settings -> Deploy keys -> Add deploy key"
  echo "(Title: oracle-server, leave 'Allow write access' OFF):"
  echo
  cat "$KEY.pub"
  echo
  read -r -p "Press Enter once it is added... " _
done
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone -q "$REPO" "$DIR"; fi

step "Settings (infra/.env)"
cd "$DIR/infra"
mkdir -p secrets backups updates
if [ -f "$HOME/fcm-service-account.json" ]; then
  mv "$HOME/fcm-service-account.json" secrets/fcm-service-account.json
  chmod 600 secrets/fcm-service-account.json
fi
if [ ! -f .env ]; then
  PRIVATE_IP=$(hostname -I | awk '{print $1}')
  sed -e "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" \
      -e "s|^ADMIN_USERS=.*|ADMIN_USERS=$ADMIN|" \
      -e "s|^TURN_SECRET=.*|TURN_SECRET=$(openssl rand -hex 32)|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
      -e "s|^PUBLIC_IP=.*|PUBLIC_IP=$PUBLIC_IP|" \
      -e "s|^PRIVATE_IP=.*|PRIVATE_IP=$PRIVATE_IP|" \
      -e "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$(openssl rand -hex 32)|" \
      .env.example > .env
  chmod 600 .env
  echo "Created infra/.env (DOMAIN=$DOMAIN, ADMIN_USERS=$ADMIN, PUBLIC_IP=$PUBLIC_IP, PRIVATE_IP=$PRIVATE_IP)"
else
  echo "infra/.env already exists - left unchanged"
fi

step "Start CellMate (first build takes a few minutes)"
sudo docker compose up -d --build

step "Waiting for https://$DOMAIN/health"
for _ in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    echo "CellMate is live at https://$DOMAIN"
    sudo docker compose logs server | grep -m1 'listening' || true
    echo
    echo "Save a copy of BACKUP_PASSPHRASE from ~/meetme/infra/.env in your password manager."
    exit 0
  fi
  sleep 5
done
echo "Not reachable yet. Check:  cd ~/meetme/infra && sudo docker compose ps && sudo docker compose logs --tail 50"
exit 1
