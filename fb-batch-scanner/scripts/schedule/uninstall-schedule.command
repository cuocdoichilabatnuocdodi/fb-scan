#!/bin/bash
# Double-click to UNINSTALL daily schedule (macOS + Linux)

set -e
LABEL="com.qing.fbscan"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  fb-batch-scanner — Daily Schedule Uninstaller                   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo

OS="$(uname -s)"
REMOVED=0

if [ "$OS" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "  ✓ Removed launchd plist: $PLIST"
    REMOVED=1
  else
    echo "  (no launchd plist found at $PLIST)"
  fi

elif [ "$OS" = "Linux" ]; then
  if crontab -l 2>/dev/null | grep -q "$LABEL"; then
    crontab -l 2>/dev/null | grep -v "$LABEL" | grep -v "# fb-batch-scanner" | crontab -
    echo "  ✓ Removed cron entry for $LABEL"
    REMOVED=1
  else
    echo "  (no crontab entry found for $LABEL)"
  fi

else
  echo "✗ Unsupported OS '$OS'."
  exit 1
fi

echo
if [ "$REMOVED" = "1" ]; then
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  ✓ UNINSTALLED — daily schedule disabled                         ║"
  echo "║  Manual run still works: node run.js                             ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════════════════════════════╗"
  echo "║  Nothing to remove (was not installed)                           ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
fi
echo

if [ -t 0 ]; then : ; else
  echo "Press ENTER to close..."
  read -r
fi
