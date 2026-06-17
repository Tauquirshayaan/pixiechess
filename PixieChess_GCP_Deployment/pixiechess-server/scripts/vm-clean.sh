#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  Pixie Chess — VM Clean Slate Script
#  Stops and removes the OLD bot deployment completely before fresh install.
#
#  HOW TO USE:
#    gcloud compute ssh VM_NAME -- "bash -s" < pixiechess-server/scripts/vm-clean.sh
#  OR upload and run:
#    gcloud compute scp pixiechess-server/scripts/vm-clean.sh VM_NAME:~/
#    gcloud compute ssh VM_NAME -- "sudo bash ~/vm-clean.sh"
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Pixie Chess — Cleaning Old Deployment               ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Disk BEFORE cleanup:"
df -h / | awk 'NR==2{print "  Used: " $3 " / " $2 " (" $5 ")"}'
echo ""

# ── Step 1: Stop all running Node.js / PM2 processes ────────────────────────
echo "▶  [1/6] Stopping running Node.js processes..."

# Stop PM2 if it exists
if command -v pm2 &>/dev/null; then
    echo "   Found PM2 — stopping all processes..."
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    pm2 kill 2>/dev/null || true
    echo "   ✅ PM2 stopped"
fi

# Kill any lingering node processes
if pgrep -x node &>/dev/null || pgrep -x ts-node &>/dev/null; then
    echo "   Found running Node.js processes — killing..."
    pkill -TERM node 2>/dev/null || true
    pkill -TERM ts-node 2>/dev/null || true
    sleep 2
    pkill -KILL node 2>/dev/null || true
    pkill -KILL ts-node 2>/dev/null || true
    echo "   ✅ Node.js processes killed"
fi

# ── Step 2: Stop and disable old systemd services ───────────────────────────
echo ""
echo "▶  [2/6] Stopping old systemd services..."

# List of possible service names the old bot might use
OLD_SERVICES=("pixiechess" "pixie-chess" "chessmind" "pixiebot" "node-app" "app")
for svc in "${OLD_SERVICES[@]}"; do
    if systemctl is-active --quiet "${svc}" 2>/dev/null; then
        echo "   Stopping service: ${svc}"
        systemctl stop "${svc}" 2>/dev/null || true
        systemctl disable "${svc}" 2>/dev/null || true
        rm -f "/etc/systemd/system/${svc}.service"
        echo "   ✅ ${svc} removed"
    fi
done
systemctl daemon-reload
echo "   ✅ systemd cleaned"

# ── Step 3: Remove old application files ─────────────────────────────────────
echo ""
echo "▶  [3/6] Removing old application files..."

# Common deployment locations to clean
OLD_DIRS=(
    "/opt/pixiechess"
    "/opt/chessmind"
    "/opt/pixiebot"
    "/var/www/pixiechess"
    "/var/www/html/pixiechess"
    "/home/ubuntu/pixiechess"
    "/home/ubuntu/pixiechessbot"
    "/home/ubuntu/Pixiechessbot"
    "/home/ubuntu/chessmind_full_deployment"
    "/home/ubuntu/chessmind"
    "/home/ubuntu/app"
    "/home/ubuntu/pixie"
    "/home/ubuntu/bot"
    "/home/ubuntu/server"
    "/root/pixiechess"
    "/root/chessmind"
    "/root/app"
)

# Also clean node_modules in any leftover project folders
echo "   Removing any leftover node_modules (frees ~500MB)..."
find /home /root /opt -maxdepth 4 -name "node_modules" -type d -prune -exec rm -rf {} + 2>/dev/null || true
echo "   ✅ node_modules removed"


# Also clean any .zip files from home directories
echo "   Removing zip files from home directories..."
find /home /root -maxdepth 2 -name "*.zip" -delete 2>/dev/null || true
find /home /root -maxdepth 2 -name "*.tar.gz" -delete 2>/dev/null || true
echo "   ✅ Zip files removed"

# Remove old directories
for dir in "${OLD_DIRS[@]}"; do
    if [ -d "${dir}" ]; then
        echo "   Removing: ${dir} ($(du -sh "${dir}" 2>/dev/null | cut -f1 || echo '?'))..."
        rm -rf "${dir}"
        echo "   ✅ Removed ${dir}"
    fi
done

# ── Step 4: Clean up old nginx configs ───────────────────────────────────────
echo ""
echo "▶  [4/6] Cleaning old nginx configurations..."

# Remove any site-specific configs (but keep nginx itself)
OLD_NGINX_CONFIGS=(
    "/etc/nginx/sites-enabled/pixiechess"
    "/etc/nginx/sites-enabled/chessmind"
    "/etc/nginx/sites-enabled/pixiebot"
    "/etc/nginx/sites-enabled/default"
    "/etc/nginx/sites-available/pixiechess"
    "/etc/nginx/sites-available/chessmind"
    "/etc/nginx/sites-available/pixiebot"
)
for conf in "${OLD_NGINX_CONFIGS[@]}"; do
    if [ -f "${conf}" ]; then
        rm -f "${conf}"
        echo "   Removed: ${conf}"
    fi
done

# Test nginx config validity (should work with just the default)
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
echo "   ✅ nginx cleaned"

# ── Step 5: Clean npm caches to free space ───────────────────────────────────
echo ""
echo "▶  [5/6] Clearing npm and pip caches..."
npm cache clean --force 2>/dev/null || true
pip3 cache purge 2>/dev/null || true
# Clear apt cache
apt-get clean 2>/dev/null || true
echo "   ✅ Caches cleared"

# ── Step 6: Uninstall old Node.js version if outdated ───────────────────────
echo ""
echo "▶  [6/6] Checking Node.js version..."
CURRENT_NODE=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1 || echo "0")
if [ "${CURRENT_NODE}" -lt "20" ]; then
    echo "   Node.js ${CURRENT_NODE} is outdated. Will reinstall Node.js 20 during setup."
    apt-get remove -y nodejs npm 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
else
    echo "   Node.js v$(node --version) is current ✅"
fi

# ── Final summary ─────────────────────────────────────────────────────────────
echo ""
echo "Disk AFTER cleanup:"
df -h / | awk 'NR==2{print "  Used: " $3 " / " $2 " (" $5 ")"}'
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Old deployment fully removed!                     ║"
echo "║  Ready for fresh install. Run vm-setup.sh next.      ║"
echo "╚══════════════════════════════════════════════════════╝"
