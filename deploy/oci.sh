#!/usr/bin/env bash
# Deploy FINN to the two OCI VMs.
#   edge   (public)  : Caddy — HTTPS for /api only, proxied to the worker (no key injection;
#                      the native app authenticates with a JWT)
#   worker (private) : FINN API (:8000) + Hermes `finn` gateway (api_server :8642, crons)
# Usage: deploy/oci.sh worker|edge|token|all
set -euo pipefail

EDGE="${EDGE:-ubuntu@129.225.119.60}"
WORKER_IP="${WORKER_IP:-10.0.1.204}"
WORKER="ubuntu@${WORKER_IP}"
DOMAIN="${DOMAIN:-129-225-119-60.sslip.io}"
REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
PAGEINDEX="${PAGEINDEX:-$HOME/building_shit/PageIndex}"
SSHJ=(ssh -o BatchMode=yes -J "$EDGE" "$WORKER")
RSYNCJ=(rsync -az -e "ssh -o BatchMode=yes -J $EDGE")

worker() {
  echo "==> worker: swap"
  "${SSHJ[@]}" 'swapon --show | grep -q swapfile || { sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile && echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null; }; free -m | sed -n 3p'

  echo "==> worker: code + data"
  # .env is NOT synced: the worker keeps its own (JWT secret, server keys).
  # The worker's DB is live (its crons ingest filings) — never overwrite it; documents ship separately.
  "${RSYNCJ[@]}" --delete --exclude .env --exclude app/ --exclude .venv/ --exclude data/research/ --exclude 'data/research_*' \
    --exclude 'data/finn.db*' --exclude data/audio/ \
    --exclude __pycache__/ --exclude .pytest_cache/ --exclude .ruff_cache/ "$REPO/" "$WORKER:/home/ubuntu/finn/"
  "${RSYNCJ[@]}" --exclude .venv/ --exclude .git/ --exclude __pycache__/ "$PAGEINDEX/" "$WORKER:/home/ubuntu/PageIndex/"

  echo "==> worker: system packages"
  "${SSHJ[@]}" 'command -v pdftotext >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q poppler-utils >/dev/null'

  echo "==> worker: python envs"
  "${SSHJ[@]}" 'export PATH=$HOME/.local/bin:$PATH
    cd ~/finn/api && uv sync -q --no-dev
    cd ~/PageIndex && [ -x .venv/bin/python ] || { uv venv -q --python 3.12 .venv && uv pip install -q --python .venv/bin/python -r requirements.txt; }
    # Hermes needs aiohttp for the finn_app bridge and the api_server; the FieldClaw install lacked it.
    /opt/hermes-agent/.venv/bin/python -c "import aiohttp" 2>/dev/null || uv pip install -q --python /opt/hermes-agent/.venv/bin/python aiohttp
    /opt/hermes-agent/.venv/bin/python -c "import mem0" 2>/dev/null || uv pip install -q --python /opt/hermes-agent/.venv/bin/python "mem0ai==2.0.18"'

  echo "==> worker: hermes profile (keys passed via a short-lived env file)"
  local tmp; tmp="$(mktemp)"
  grep -E '^(FIREWORKS_API_KEY|EXA_API_KEY|DATALAB_API_KEY|OPENROUTER_API_KEY|MEM0_API_KEY|SMALLEST_API_KEY)=' "$HOME/.hermes-finn/.env" > "$tmp"
  grep -E '^TYPESAFE_API_KEY=' "$REPO/.env" >> "$tmp" || true
  "${RSYNCJ[@]}" "$tmp" "$WORKER:/home/ubuntu/.finn-provision.env"
  rm -f "$tmp"
  "${SSHJ[@]}" 'set -a; . ~/.finn-provision.env; set +a
    touch ~/finn/.env; chmod 600 ~/finn/.env
    grep -q "^TYPESAFE_API_KEY=" ~/finn/.env || grep "^TYPESAFE_API_KEY=" ~/.finn-provision.env >> ~/finn/.env || true
    grep -q "^FINN_JWT_SECRET=" ~/finn/.env || echo "FINN_JWT_SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")" >> ~/finn/.env
    rm -f ~/.finn-provision.env
    export PATH=$HOME/.local/bin:$PATH
    FINN_REPO=/home/ubuntu/finn HERMES_BIN=/opt/hermes-agent/.venv/bin/hermes \
      PLUGIN_SRC=/opt/fieldclaw/deploy/hermes/plugins/protect-identity \
      bash ~/finn/hermes/provision.sh | tail -6'

  echo "==> worker: research document records"
  (cd "$REPO/api" && uv run finn export-docs 2>/dev/null) > /tmp/finn-docs.json
  "${RSYNCJ[@]}" /tmp/finn-docs.json "$WORKER:/home/ubuntu/finn-docs.json" && rm -f /tmp/finn-docs.json
  "${SSHJ[@]}" 'cd ~/finn/api && .venv/bin/finn import-docs ~/finn-docs.json && rm -f ~/finn-docs.json'

  echo "==> worker: FCM sender key (server only)"
  if [ -f "${FCM_KEY:-/run/media/rdksupe/finn/.secrets/fcm-sa.json}" ]; then
    "${SSHJ[@]}" 'mkdir -p ~/.finn-secrets && chmod 700 ~/.finn-secrets'
    "${RSYNCJ[@]}" --chmod=F600 "${FCM_KEY:-/run/media/rdksupe/finn/.secrets/fcm-sa.json}" "$WORKER:/home/ubuntu/.finn-secrets/fcm-sa.json"
    "${SSHJ[@]}" 'grep -q "^FINN_FCM_CREDENTIALS=" ~/finn/.env || echo "FINN_FCM_CREDENTIALS=/home/ubuntu/.finn-secrets/fcm-sa.json" >> ~/finn/.env'
  fi

  echo "==> worker: services"
  "${SSHJ[@]}" 'sudo tee /etc/systemd/system/finn-api.service >/dev/null <<EOF
[Unit]
Description=FINN API
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/finn/api
Environment=PATH=/home/ubuntu/.local/bin:/usr/bin:/bin
ExecStart=/home/ubuntu/finn/api/.venv/bin/uvicorn finn_api.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/finn-hermes.service >/dev/null <<EOF
[Unit]
Description=FINN Hermes gateway (chat API + crons)
After=network-online.target finn-api.service

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/finn
Environment=PATH=/home/ubuntu/.local/bin:/usr/bin:/bin
ExecStart=/home/ubuntu/.local/bin/hermes-finn gateway run
Restart=always
RestartSec=5
TimeoutStopSec=240

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable -q --now finn-api finn-hermes
sudo systemctl restart finn-api finn-hermes
sleep 6; systemctl is-active finn-api finn-hermes; curl -s localhost:8000/health'
}

edge() {
  echo "==> edge: caddy (HTTPS reverse proxy for /api; everything else 404)"
  ssh -o BatchMode=yes "$EDGE" "command -v caddy >/dev/null || {
      curl -fsSL 'https://caddyserver.com/api/download?os=linux&arch=amd64' -o /tmp/caddy && sudo install -m 755 /tmp/caddy /usr/local/bin/caddy; }
    sudo mkdir -p /etc/caddy
    sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
$DOMAIN {
	encode zstd gzip

	handle /api/* {
		reverse_proxy $WORKER_IP:8000 {
			flush_interval -1
		}
	}

	handle {
		respond 404
	}
}
EOF
    sudo tee /etc/systemd/system/caddy.service >/dev/null <<'EOF'
[Unit]
Description=Caddy (FINN edge)
After=network-online.target

[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload && sudo systemctl enable -q --now caddy && sudo systemctl restart caddy
    sleep 3; systemctl is-active caddy"
  echo "    https://$DOMAIN/api"
}

token() {
  # Minted on the worker, where the secret lives. Prints only the token.
  "${SSHJ[@]}" "export PATH=\$HOME/.local/bin:\$PATH; cd ~/finn/api && .venv/bin/finn token --sub \"${TOKEN_SUB:-finn-app}\" --days \"${TOKEN_DAYS:-30}\""
}

case "${1:-all}" in
  worker) worker ;;
  edge) edge ;;
  token) token ;;
  all) worker; edge ;;
  *) echo "usage: $0 worker|edge|token|all" >&2; exit 2 ;;
esac
