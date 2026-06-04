#!/bin/bash
# ============================================
# TioRico Device Provisioning Script
# ============================================
# Run on a fresh Ubuntu 24.04 LTS (x86_64) mini PC.
# Installs everything needed to run the automation system.
#
# Usage:
#   chmod +x provision-device.sh
#   sudo ./provision-device.sh
#
# After running:
#   1. Configure Chrome extensions (options pages)
#   2. Log into WhatsApp Web
#   3. Log into the casino panel
#   4. Set the backend URL in extension options
# ============================================

set -e

echo "============================================"
echo " TioRico Device Provisioning"
echo " Ubuntu 24.04 LTS — x86_64"
echo "============================================"

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Error: Run as root (sudo ./provision-device.sh)"
  exit 1
fi

TIORICO_HOME="/opt/tiorico"
TIORICO_USER="tiorico"

# ============================================
# 1. System packages
# ============================================
echo ""
echo "[1/8] Installing system packages..."
apt-get update -y
apt-get install -y \
  curl wget git unzip \
  build-essential \
  xvfb xdg-utils \
  fonts-liberation libnss3 libxss1 libasound2t64 \
  libgbm1 libgtk-3-0 libx11-xcb1 \
  nginx \
  ufw

# ============================================
# 1b. Tailscale (remote access for support)
# ============================================
echo ""
echo "[1b/8] Installing Tailscale (remote access)..."
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo "Tailscale installed. Run 'sudo tailscale up' after provisioning to connect."
else
  echo "Tailscale already installed"
fi

# ============================================
# 2. Create tiorico user
# ============================================
echo ""
echo "[2/7] Creating tiorico user..."
if ! id "$TIORICO_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$TIORICO_USER"
  echo "User $TIORICO_USER created"
else
  echo "User $TIORICO_USER already exists"
fi

# ============================================
# 3. Node.js 20 LTS
# ============================================
echo ""
echo "[3/7] Installing Node.js 20 LTS..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

# Install PM2 globally
npm install -g pm2

# ============================================
# 4. Google Chrome
# ============================================
echo ""
echo "[4/7] Installing Google Chrome..."
if ! command -v google-chrome &>/dev/null; then
  wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/chrome.deb || apt-get -f install -y
  rm -f /tmp/chrome.deb
fi
echo "Chrome: $(google-chrome --version)"

# ============================================
# 5. Ollama
# ============================================
echo ""
echo "[5/7] Installing Ollama..."
if ! command -v ollama &>/dev/null; then
  curl -fsSL https://ollama.com/install.sh | sh
fi
echo "Ollama: $(ollama --version 2>/dev/null || echo 'installed')"

# Pull a lightweight vision model for validation
echo "Pulling moondream model (lightweight vision, ~1.8GB)..."
ollama pull moondream || echo "Model pull failed — can be done manually later"

# ============================================
# 6. Create directory structure
# ============================================
echo ""
echo "[6/7] Setting up TioRico directory structure..."
mkdir -p "$TIORICO_HOME"/{extensions,apps,config,logs,data}

# Copy extensions if available in the repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -d "$REPO_ROOT/apps/automation-extension" ]; then
  cp -r "$REPO_ROOT/apps/automation-extension" "$TIORICO_HOME/extensions/automation"
  echo "Automation extension copied"
fi

if [ -d "$REPO_ROOT/apps/whatsapp-extension" ]; then
  cp -r "$REPO_ROOT/apps/whatsapp-extension" "$TIORICO_HOME/extensions/whatsapp"
  echo "WhatsApp extension copied"
fi

# Config templates
cat > "$TIORICO_HOME/config/README.md" << 'CONFIGEOF'
# TioRico Device Configuration

## After provisioning:
1. Open Chrome and load extensions from /opt/tiorico/extensions/
2. Configure each extension via its Options page (backend URL, API key, etc.)
3. Log into WhatsApp Web in a separate Chrome profile
4. Log into the casino panel
5. Verify connections via extension popups

## Chrome profiles:
- Profile 1: Casino panel + automation extension
- Profile 2: WhatsApp Web + WhatsApp extension

## Start/stop services:
  sudo systemctl start tiorico-chrome-panel
  sudo systemctl start tiorico-chrome-whatsapp
  sudo systemctl start ollama

## Logs:
  journalctl -u tiorico-chrome-panel -f
  journalctl -u tiorico-chrome-whatsapp -f
  /opt/tiorico/logs/
CONFIGEOF

# ============================================
# 7. Systemd services
# ============================================
echo ""
echo "[7/7] Creating systemd services..."

# Chrome for casino panel automation
cat > /etc/systemd/system/tiorico-chrome-panel.service << EOF
[Unit]
Description=TioRico Chrome - Casino Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TIORICO_USER
Environment=DISPLAY=:99
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 &
ExecStart=/usr/bin/google-chrome \
  --user-data-dir=$TIORICO_HOME/data/chrome-panel \
  --load-extension=$TIORICO_HOME/extensions/automation \
  --no-first-run \
  --disable-default-apps \
  --disable-extensions-except=$TIORICO_HOME/extensions/automation \
  --password-store=basic \
  --disable-background-networking \
  --window-size=1920,1080
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Chrome for WhatsApp
cat > /etc/systemd/system/tiorico-chrome-whatsapp.service << EOF
[Unit]
Description=TioRico Chrome - WhatsApp Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TIORICO_USER
Environment=DISPLAY=:98
ExecStartPre=/usr/bin/Xvfb :98 -screen 0 1920x1080x24 &
ExecStart=/usr/bin/google-chrome \
  --user-data-dir=$TIORICO_HOME/data/chrome-whatsapp \
  --load-extension=$TIORICO_HOME/extensions/whatsapp \
  --no-first-run \
  --disable-default-apps \
  --disable-extensions-except=$TIORICO_HOME/extensions/whatsapp \
  --password-store=basic \
  --disable-background-networking \
  --window-size=1920,1080
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Set ownership
chown -R "$TIORICO_USER":"$TIORICO_USER" "$TIORICO_HOME"

# Reload systemd
systemctl daemon-reload

echo ""
echo "============================================"
echo " Provisioning Complete!"
echo "============================================"
echo ""
echo "Directory: $TIORICO_HOME"
echo ""
echo "Next steps:"
echo "  1. Start Chrome manually first to configure extensions"
echo "     su - $TIORICO_USER"
echo "     google-chrome --user-data-dir=$TIORICO_HOME/data/chrome-panel"
echo "  2. Load extension: chrome://extensions → Developer mode → Load unpacked"
echo "     Path: $TIORICO_HOME/extensions/automation"
echo "  3. Configure via Options page (backend URL, API key, panel credentials)"
echo "  4. Repeat for WhatsApp extension"
echo "  5. Enable systemd services:"
echo "     sudo systemctl enable --now tiorico-chrome-panel"
echo "     sudo systemctl enable --now tiorico-chrome-whatsapp"
echo ""
echo "  6. Connect Tailscale (remote access for support):"
echo "     sudo tailscale up"
echo "     Follow the auth link to add this device to your Tailscale network"
echo ""
