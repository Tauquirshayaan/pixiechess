#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  Pixie Chess NNUE — GCP GPU VM Training Script
#  Run this ON the GCP VM after SSH-ing in.
#
#  Usage (on your local machine first):
#    1. Create the VM:
#       gcloud compute instances create pixie-trainer \
#         --zone=us-central1-a \
#         --machine-type=n1-standard-4 \
#         --accelerator=type=nvidia-tesla-t4,count=1 \
#         --image-family=pytorch-latest-gpu \
#         --image-project=deeplearning-platform-release \
#         --maintenance-policy=TERMINATE \
#         --preemptible \
#         --boot-disk-size=40GB
#
#    2. Upload training data + script:
#       gcloud compute scp pixiechess-server/training_data.jsonl pixie-trainer:~/
#       gcloud compute scp nnue/train_nnue.py pixie-trainer:~/
#       gcloud compute scp nnue/train_gcp.sh pixie-trainer:~/
#
#    3. SSH in and run:
#       gcloud compute ssh pixie-trainer --zone=us-central1-a
#       chmod +x train_gcp.sh && ./train_gcp.sh
#
#    4. Download trained weights:
#       gcloud compute scp pixie-trainer:~/pixiechess.nnue \
#         pixiechess-server/src/engine/bin/pixiechess.nnue
#
#    5. Delete the VM when done to stop billing:
#       gcloud compute instances delete pixie-trainer --zone=us-central1-a
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail

echo "════════════════════════════════════════════"
echo "  Pixie Chess NNUE — GCP Training Setup"
echo "════════════════════════════════════════════"

# ── Install Python dependencies ──────────────────────────────────────────
echo "▶  Installing PyTorch (CUDA 12.1) + HuggingFace datasets..."
pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -q datasets

# ── Verify GPU ────────────────────────────────────────────────────────────
echo "▶  GPU Status:"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

# ── Run Training ──────────────────────────────────────────────────────────
echo "▶  Starting training..."
python train_nnue.py

echo ""
echo "════════════════════════════════════════════"
echo "✅ Training complete!"
echo "   Download the weights with:"
echo "   gcloud compute scp pixie-trainer:~/pixiechess.nnue \\"
echo "     pixiechess-server/src/engine/bin/pixiechess.nnue"
echo "════════════════════════════════════════════"
