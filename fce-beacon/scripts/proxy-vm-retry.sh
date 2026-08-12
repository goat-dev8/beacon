#!/usr/bin/env bash
# Retry ext-proxy until the shared Coston2 indexer accepts a connection.
# One attempt per cycle; stop immediately on max_user_connections so we do not leak slots.
set -euo pipefail
COMPOSE=(docker compose -f /opt/beacon-fcc/docker-compose.yaml --env-file /opt/beacon-fcc/.env)
for i in $(seq 1 40); do
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) attempt=$i"
  "${COMPOSE[@]}" up -d ext-proxy
  sleep 12
  logs="$("${COMPOSE[@]}" logs --tail=30 ext-proxy 2>/dev/null || true)"
  if echo "$logs" | grep -q "max_user_connections"; then
    "${COMPOSE[@]}" stop ext-proxy >/dev/null
    echo "indexer_full sleep=90"
    sleep 90
    continue
  fi
  if curl -sf -m 8 http://127.0.0.1:6664/info >/tmp/ext-info.json; then
    echo "PROXY_UP"
    head -c 400 /tmp/ext-info.json || true
    echo
    exit 0
  fi
  status="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' beacon-fcc-ext-proxy-1 2>/dev/null || echo missing)"
  echo "info_not_ready status=$status"
  if echo "$status" | grep -q '^running'; then
    sleep 20
    if curl -sf -m 8 http://127.0.0.1:6664/info >/tmp/ext-info.json; then
      echo "PROXY_UP"
      exit 0
    fi
  fi
  "${COMPOSE[@]}" stop ext-proxy >/dev/null || true
  sleep 90
done
echo "PROXY_RETRY_FAILED"
exit 1
