#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  Pixie Chess — GCP Cloud Run Deployment Script
#  Usage: ./deploy.sh [YOUR_GCP_PROJECT_ID] [REGION]
#  Example: ./deploy.sh my-gcp-project us-central1
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail

PROJECT_ID="${1:-YOUR_GCP_PROJECT_ID}"
REGION="${2:-us-central1}"
SERVICE_NAME="pixiechess"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Pixie Chess → GCP Cloud Run                         ║"
echo "║  Project:  ${PROJECT_ID}"
echo "║  Region:   ${REGION}"
echo "║  Image:    ${IMAGE}"
echo "╚══════════════════════════════════════════════════════╝"

# ── Step 0: Validate gcloud auth ────────────────────────────────────────
if ! command -v gcloud &> /dev/null; then
  echo "❌ gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

echo ""
echo "▶  Step 1: Building frontend..."
cd ../pixiechess-bot
npm ci --silent
npm run build
cd ../pixiechess-server

echo ""
echo "▶  Step 2: Building Docker image (C++ compile + TS compile inside)..."
# Build from the parent directory so Docker can access both pixiechess-server and pixie-engine-cpp
cd ..
docker build \
  -f pixiechess-server/Dockerfile \
  -t "${IMAGE}:latest" \
  --platform linux/amd64 \
  .

echo ""
echo "▶  Step 3: Pushing image to GCP Container Registry..."
docker push "${IMAGE}:latest"

echo ""
echo "▶  Step 4: Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}:latest" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 4 \
  --max-instances 10 \
  --min-instances 0 \
  --port 3000 \
  --project "${PROJECT_ID}"

echo ""
echo "✅ Deployment complete!"
echo "   Service URL: $(gcloud run services describe ${SERVICE_NAME} --region=${REGION} --project=${PROJECT_ID} --format='value(status.url)')"
