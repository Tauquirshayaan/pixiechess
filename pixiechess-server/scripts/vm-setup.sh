#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  Pixie Chess — VM One-Time Setup Script
#  Run this REMOTELY on your GCP VM (Ubuntu 22.04)
#
#  HOW TO USE (from your Windows machine):
#    1. gcloud compute scp pixiechess-server/scripts/vm-setup.sh VM_NAME:~/
#    2. gcloud compute ssh VM_NAME
#    3. chmod +x vm-setup.sh && sudo ./vm-setup.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

DEPLOY_DIR="/opt/pixiechess"
SERVICE_USER="pixiechess"
NODE_VERSION="20"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Pixie Chess — GCP VM Setup (8 vCPU / 8 GB)         ║"
echo "╚══════════════════════════════════════════════════════╝"

# ── Step 1: System dependencies ─────────────────────────────────────────────
echo ""
echo "▶  [1/8] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    curl git wget unzip \
    g++ cmake make \
    nginx \
    python3 python3-pip \
    certbot python3-certbot-nginx \
    htop

# ── Step 2: Node.js 20 ──────────────────────────────────────────────────────
echo ""
echo "▶  [2/8] Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null || [[ "$(node --version)" != v${NODE_VERSION}* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi
echo "   Node.js: $(node --version) | npm: $(npm --version)"

# ── Step 3: Create deploy directory and service user ────────────────────────
echo ""
echo "▶  [3/8] Creating service user and directories..."
if ! id "${SERVICE_USER}" &>/dev/null; then
    useradd --system --shell /bin/false --home-dir "${DEPLOY_DIR}" "${SERVICE_USER}"
fi
mkdir -p "${DEPLOY_DIR}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${DEPLOY_DIR}"

# ── Step 4: Build C++ Engine natively on this machine ───────────────────────
echo ""
echo "▶  [4/8] Building C++ chess engine (using all 8 vCPUs)..."
if [ -d "${DEPLOY_DIR}/pixie-engine-cpp" ]; then
    cd "${DEPLOY_DIR}/pixie-engine-cpp"
    cmake -B build -S . -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_FLAGS="-O3 -mavx2 -mbmi2 -ffast-math"
    cmake --build build --target pixie-engine-cpp -j"$(nproc)"
    
    # Install into server bin directory
    BIN_PATH="${DEPLOY_DIR}/pixiechess-server/src/engine/bin"
    mkdir -p "${BIN_PATH}"
    cp build/pixie-engine-cpp "${BIN_PATH}/pixie-engine-cpp"
    chmod +x "${BIN_PATH}/pixie-engine-cpp"
    echo "   ✅ Engine binary installed at ${BIN_PATH}/pixie-engine-cpp"
    echo "   Binary size: $(du -sh ${BIN_PATH}/pixie-engine-cpp | cut -f1)"
else
    echo "   ⚠️  pixie-engine-cpp source not found at ${DEPLOY_DIR}/pixie-engine-cpp"
    echo "      Upload it first with: gcloud compute scp -r pixie-engine-cpp VM_NAME:${DEPLOY_DIR}/"
fi

# ── Step 5: Install Node.js dependencies ────────────────────────────────────
echo ""
echo "▶  [5/8] Installing Node.js dependencies..."

# Frontend
if [ -d "${DEPLOY_DIR}/pixiechess-bot" ]; then
    cd "${DEPLOY_DIR}/pixiechess-bot"
    npm ci --silent
    echo "   ✅ pixiechess-bot dependencies installed"
fi

# Server
if [ -d "${DEPLOY_DIR}/pixiechess-server" ]; then
    cd "${DEPLOY_DIR}/pixiechess-server"
    npm ci --silent
    echo "   ✅ pixiechess-server dependencies installed"
fi

# ── Step 6: Build Frontend ───────────────────────────────────────────────────
echo ""
echo "▶  [6/8] Building React frontend..."
if [ -d "${DEPLOY_DIR}/pixiechess-bot" ]; then
    cd "${DEPLOY_DIR}/pixiechess-bot"
    npm run build
    echo "   ✅ Frontend built: $(du -sh dist | cut -f1)"
fi

# ── Step 7: Install systemd service ─────────────────────────────────────────
echo ""
echo "▶  [7/8] Installing systemd service..."
cp "${DEPLOY_DIR}/pixiechess-server/scripts/pixiechess.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable pixiechess
systemctl restart pixiechess
sleep 2
if systemctl is-active --quiet pixiechess; then
    echo "   ✅ Service is running!"
    systemctl status pixiechess --no-pager -l | head -10
else
    echo "   ❌ Service failed to start. Check: journalctl -u pixiechess -n 50"
fi

# ── Step 8: Configure nginx ──────────────────────────────────────────────────
echo ""
echo "▶  [8/8] Configuring nginx..."
cp "${DEPLOY_DIR}/pixiechess-server/scripts/nginx.conf" /etc/nginx/sites-available/pixiechess
ln -sf /etc/nginx/sites-available/pixiechess /etc/nginx/sites-enabled/pixiechess
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "   ✅ nginx configured and reloaded"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Setup Complete!                                   ║"
echo "╠══════════════════════════════════════════════════════╣"
EXTERNAL_IP=$(curl -s --max-time 3 http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "unknown")
echo "║  External IP:  ${EXTERNAL_IP}"
echo "║  App URL:      http://${EXTERNAL_IP}"
echo "║  Disk usage:   $(df -h / | awk 'NR==2{print $3 "/" $2 " used (" $5 ")"}')"
echo "║  RAM usage:    $(free -h | awk '/Mem/{print $3 "/" $2}')"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Useful commands:                                     ║"
echo "║    sudo systemctl status pixiechess                  ║"
echo "║    sudo journalctl -u pixiechess -f                  ║"
echo "║    sudo systemctl restart pixiechess                 ║"
echo "╚══════════════════════════════════════════════════════╝"
