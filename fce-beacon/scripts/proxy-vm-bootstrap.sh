#!/usr/bin/env bash
# Run on the proxy VM after config.toml, docker-compose.yaml, and .env are in /opt/beacon-fcc.
# .env must contain PROXY_PRIVATE_KEY, NGROK_AUTHTOKEN, NGROK_DOMAIN — never commit that file.
set -euxo pipefail
cd /opt/beacon-fcc
chmod 600 /opt/beacon-fcc/.env
chmod 644 /opt/beacon-fcc/config.toml
set -a
# shellcheck disable=SC1091
source /opt/beacon-fcc/.env
set +a
: "${PROXY_PRIVATE_KEY:?}"
: "${NGROK_AUTHTOKEN:?}"
: "${NGROK_DOMAIN:?}"

TOKEN="$(curl -sS -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | jq -r .access_token)"
echo "$TOKEN" | docker login -u oauth2accesstoken --password-stdin https://us-central1-docker.pkg.dev

docker compose -f /opt/beacon-fcc/docker-compose.yaml --env-file /opt/beacon-fcc/.env pull
docker compose -f /opt/beacon-fcc/docker-compose.yaml --env-file /opt/beacon-fcc/.env up -d

cat >/etc/systemd/system/ngrok-fcc.service <<UNIT
[Unit]
Description=ngrok reserved domain for Beacon FCC ext-proxy
After=docker.service network-online.target
Wants=network-online.target

[Service]
Restart=always
RestartSec=5
EnvironmentFile=/opt/beacon-fcc/.env
ExecStart=/usr/local/bin/ngrok http --url=\${NGROK_DOMAIN} 6664

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now ngrok-fcc.service
sleep 4
docker compose -f /opt/beacon-fcc/docker-compose.yaml ps
systemctl is-active ngrok-fcc.service
curl -sS -m 5 http://127.0.0.1:6664/info || true
curl -sS -m 5 http://127.0.0.1:4040/api/tunnels || true
