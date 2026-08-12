#!/usr/bin/env bash
# Build Beacon FCC extension image with MODE=0 for GCP Confidential Space.
# Does NOT touch the default go/Dockerfile (MODE=1) used by simulated path.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG_DIR="${ROOT}/../docs/evidence/hardware-fcc"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/docker-build-hardware.log"
EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
export SOURCE_DATE_EPOCH="$EPOCH" DOCKER_BUILDKIT=1
TAG="${1:-beacon-fcc-hardware:v0.1.0}"
DF="${ROOT}/go/Dockerfile.hardware"
if [[ ! -f "$DF" ]]; then
  echo "ERROR: missing $DF" >&2
  exit 1
fi
if ! grep -q 'ENV MODE=0' "$DF"; then
  echo "ERROR: Dockerfile.hardware must bake MODE=0" >&2
  exit 1
fi
{
  echo "[start] SOURCE_DATE_EPOCH=$EPOCH tag=$TAG $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  docker build -f go/Dockerfile.hardware -t "$TAG" --build-arg "SOURCE_DATE_EPOCH=$EPOCH" .
  echo "[inspect]"
  docker inspect "$TAG" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^MODE=' || true
  docker inspect "$TAG" --format '{{index .Config.Labels "tee.launch_policy.allow_env_override"}}'
  echo "[done] $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} 2>&1 | tee "$LOG"
