#!/usr/bin/env bash
# One-time server setup and (re)deployment, run on the server from the unpacked repository:
#   bash deploy/oracle/setup.sh
# Installs Docker, opens ports 80/443 in the host firewall, writes .env (random database
# password, sslip.io hostname for HTTPS) on first run, then builds and starts the stack.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Oracle's Ubuntu images reject inbound traffic in iptables except SSH.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 5 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

if [ ! -f .env ]; then
  ip=$(curl -fsS https://api.ipify.org)
  umask 077
  cat > .env <<ENV
SITE_ADDRESS=${ip}.sslip.io
AEGIS_DB_PASSWORD=$(openssl rand -hex 24)
ENV
  echo "Created .env for https://${ip}.sslip.io"
fi

sudo docker compose -f docker-compose.yml -f deploy/oracle/docker-compose.oracle.yml up -d --build
sudo docker compose -f docker-compose.yml -f deploy/oracle/docker-compose.oracle.yml ps
