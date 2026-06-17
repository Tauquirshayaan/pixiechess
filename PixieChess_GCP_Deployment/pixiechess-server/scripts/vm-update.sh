#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  Pixie Chess — Fast Code Update Script
#  Run this REMOTELY on the VM to pull latest code changes.
#  Does NOT re-install dependencies or re-build C++ engine.
#
#  HOW TO USE (from your Windows machine, after initial deploy):
#    gcloud compute ssh VM_NAME -- "cd /opt/pixiechess && sudo bash pixiechess-server/scripts/vm-update.sh"
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DEPLOY_DIR="/opt/pixiechess"
SERVICE_USER="pixiechess"

echo "▶  Rebuilding frontend..."
cd "${DEPLOY_DIR}/pixiechess-bot"
npm run build

echo "▶  Restarting Pixie Chess server..."
systemctl restart pixiechess
sleep 2

if systemctl is-active --quiet pixiechess; then
    echo "✅ Server restarted successfully!"
    echo "   Disk: $(df -h / | awk 'NR==2{print $3 "/" $2}')"
    echo "   RAM:  $(free -h | awk '/Mem/{print $3 "/" $2}')"
else
    echo "❌ Server failed to restart. Check logs:"
    journalctl -u pixiechess -n 20 --no-pager
fi
