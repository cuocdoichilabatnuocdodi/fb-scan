#!/bin/bash
# Double-click to INSTALL daily schedule (macOS + Linux)
#
# Auto-detects OS:
#   macOS → launchd plist at ~/Library/LaunchAgents/com.qing.fbscan.plist
#   Linux → crontab entry
#
# Default time: 08:00 daily. Edit SCHEDULE_HOUR / SCHEDULE_MIN below to change.

set -e

# ╔══════════════════════════════════════════╗
# ║  EDIT THESE TO CHANGE RUN TIME           ║
# ╠══════════════════════════════════════════╣
SCHEDULE_HOUR=8
SCHEDULE_MIN=0
# ╚══════════════════════════════════════════╝

LABEL="com.qing.fbscan"
# Resolve project dir (this script lives in scripts/schedule/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  fb-batch-scanner — Daily Schedule Installer                     ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "  Project: $PROJECT_DIR"
echo "  Run time: $(printf '%02d:%02d' $SCHEDULE_HOUR $SCHEDULE_MIN) daily"
echo

# Find node
NODE_BIN="$(command -v node)" || true
if [ -z "$NODE_BIN" ] && [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NODE_BIN="$(command -v node)" || true
fi
if [ -z "$NODE_BIN" ]; then
  echo "✗ ERROR: 'node' not found in PATH. Install Node.js first."
  exit 1
fi
echo "  Node: $NODE_BIN"
echo

# ─── Bootstrap: install npm deps + Chromium if missing (so cron-fired runs work) ─
if [ ! -d "$PROJECT_DIR/node_modules/playwright" ]; then
  echo "  ⚙️  Running 'npm install' (first time, ~30s)..."
  ( cd "$PROJECT_DIR" && npm install ) || { echo "✗ npm install failed"; exit 1; }
  echo
fi
if ! ( cd "$PROJECT_DIR" && "$NODE_BIN" -e "require('playwright').chromium.executablePath()" ) >/dev/null 2>&1; then
  echo "  ⚙️  Downloading Playwright Chromium (first time, ~170MB)..."
  ( cd "$PROJECT_DIR" && npx playwright install chromium ) || { echo "✗ playwright install failed"; exit 1; }
  echo
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  # ─── macOS: launchd ───────────────────────────────────────────────
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  echo "  Detected macOS → installing launchd plist:"
  echo "  $PLIST"
  echo

  # Unload existing first (idempotent)
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
  fi

  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-c</string>
    <string>PID=\$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null | head -n1); [ -n "\$PID" ] && kill -9 \$PID; sleep 1; cd "$PROJECT_DIR" && "$NODE_BIN" run.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$SCHEDULE_HOUR</integer>
    <key>Minute</key><integer>$SCHEDULE_MIN</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$PROJECT_DIR/logs/launchd.out</string>
  <key>StandardErrorPath</key>
  <string>$PROJECT_DIR/logs/launchd.err</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
EOF

  launchctl load "$PLIST"
  echo "  ✓ Loaded: launchctl list | grep $LABEL"
  launchctl list | grep "$LABEL" || true

elif [ "$OS" = "Linux" ]; then
  # ─── Linux: cron ──────────────────────────────────────────────────
  echo "  Detected Linux → installing crontab entry"
  CRON_LINE="$SCHEDULE_MIN $SCHEDULE_HOUR * * * PID=\$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null | head -n1); [ -n \"\$PID\" ] && kill -9 \$PID; sleep 1; cd \"$PROJECT_DIR\" && \"$NODE_BIN\" run.js >> \"$PROJECT_DIR/logs/cron.out\" 2>> \"$PROJECT_DIR/logs/cron.err\""
  MARKER="# fb-batch-scanner ($LABEL)"

  # Remove existing entry then add fresh
  (crontab -l 2>/dev/null | grep -v "$LABEL" ; echo "$MARKER" ; echo "$CRON_LINE") | crontab -
  echo "  ✓ Crontab updated:"
  crontab -l | grep -A1 "$LABEL"

else
  echo "✗ ERROR: Unsupported OS '$OS'. This script supports macOS and Linux only."
  exit 1
fi

echo
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  ✓ INSTALLED                                                     ║"
echo "║  Next run: $(printf '%02d:%02d' $SCHEDULE_HOUR $SCHEDULE_MIN) (Mac must be awake + logged in)             ║"
echo "║  Test now: launchctl start $LABEL  (mac)                  ║"
echo "║  Test now: $NODE_BIN $PROJECT_DIR/run.js (linux/mac)             ║"
echo "║  Uninstall: double-click uninstall-schedule.command              ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo

# Keep window open if double-clicked from Finder
if [ -t 0 ]; then : ; else
  echo "Press ENTER to close..."
  read -r
fi
