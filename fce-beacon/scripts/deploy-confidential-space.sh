#!/usr/bin/env bash
# Deploy Beacon FCC TEE to GCP Confidential Space (AMD SEV).
# Prerequisites:
#   - gcloud authenticated, billing active (Egypt: $10 prepay + tax info)
#   - image pushed to Artifact Registry
#   - stable EXT_PROXY HTTPS URL (named tunnel / reserved domain) reachable on 6664
# Usage:
#   ./scripts/deploy-confidential-space.sh <ARTIFACT_IMAGE> <PROXY_URL> [ZONE]
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-project-62df34c9-fd72-4fee-80f}"
ZONE="${3:-us-central1-a}"
INSTANCE="${CS_INSTANCE_NAME:-beacon-fcc-tee}"
SA_NAME="${CS_SA_NAME:-beacon-fcc-tee-sa}"
IMAGE_REF="${1:?usage: $0 <artifact-image-ref> <proxy-url> [zone]}"
PROXY_URL="${2:?proxy URL required (reachable from TEE)}"
CHAIN_URL="${CHAIN_URL:-https://coston2-api.flare.network/ext/C/rpc}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/config/extension.env"
: "${EXTENSION_ID:?missing EXTENSION_ID in config/extension.env}"
: "${INITIAL_OWNER:?set INITIAL_OWNER in env}"

echo "[cs] project=$PROJECT_ID zone=$ZONE instance=$INSTANCE"
echo "[cs] image=$IMAGE_REF"
echo "[cs] extensionId=$EXTENSION_ID"
echo "[cs] proxy=$PROXY_URL"

gcloud config set project "$PROJECT_ID"
gcloud services enable compute.googleapis.com artifactregistry.googleapis.com confidentialcomputing.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

# Workload SA (least privilege)
if ! gcloud iam service-accounts describe "${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Beacon FCC Confidential Space TEE" \
    --project "$PROJECT_ID"
fi
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/confidentialcomputing.workloadUser" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.reader" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.logWriter" --quiet >/dev/null

# Metadata: tee-image-reference + env overrides (MODE=0 required for GCP_AMD_SEV)
# Do NOT set tee-container-log-redirect=true on the production
# confidential-space image family — the launcher errors with
# "logging redirection only allowed on debug environment by image"
# and powers off the VM. Use confidential-space-debug only when debugging.
META="^~^tee-image-reference=${IMAGE_REF}"
META+="~tee-restart-policy=Always"
META+="~tee-env-MODE=0"
META+="~tee-env-CHAIN_ID=114"
META+="~tee-env-EXTENSION_ID=${EXTENSION_ID}"
META+="~tee-env-INITIAL_OWNER=${INITIAL_OWNER}"
META+="~tee-env-CHAIN_URL=${CHAIN_URL}"
META+="~tee-env-PROXY_URL=${PROXY_URL}"
META+="~tee-env-LOG_LEVEL=INFO"
META+="~tee-env-GOVERNANCE_SIGNERS=${GOVERNANCE_SIGNERS:-$INITIAL_OWNER}"
META+="~tee-env-GOVERNANCE_THRESHOLD=${GOVERNANCE_THRESHOLD:-1}"

# Cheapest SEV-capable default: n2d-standard-2 in us-central1-a (MIGRATE for N2D SEV)
if gcloud compute instances describe "$INSTANCE" --zone "$ZONE" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "[cs] instance already exists — delete/recreate manually if image changed"
  exit 0
fi

gcloud compute instances create "$INSTANCE" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --machine-type=n2d-standard-2 \
  --min-cpu-platform="AMD Milan" \
  --confidential-compute-type=SEV \
  --maintenance-policy=MIGRATE \
  --shielded-secure-boot \
  --image-project=confidential-space-images \
  --image-family=confidential-space \
  --service-account="$SA_EMAIL" \
  --scopes=cloud-platform \
  --boot-disk-size=20GB \
  --metadata="$META"

echo "[cs] created. Wait for workload pull + attestation, then verify via EXT_PROXY /info:"
echo "  curl -s \"\$EXT_PROXY_URL/info\" | jq '.machineData'"
echo "Expect platform GCP_AMD_SEV (0x4743505f414d445f534556…) and non-simulated codeHash."
