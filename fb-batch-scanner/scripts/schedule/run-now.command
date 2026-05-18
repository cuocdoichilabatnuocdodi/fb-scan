#!/bin/bash
# Double-click to RUN BATCH NOW (macOS + Linux)
# Same as: cd <project> && node run.js
# Use to test schedule manually, or scan on-demand without waiting for daily fire.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║  fb-batch-scanner — Run Now                                      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo "  Project: $PROJECT_DIR"
echo

NODE_BIN="$(command -v node)" || true
if [ -z "$NODE_BIN" ] && [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  NODE_BIN="$(command -v node)" || true
fi
if [ -z "$NODE_BIN" ]; then
  echo "✗ ERROR: 'node' not found. Install Node.js first."
  echo
  echo "Press ENTER to close..."
  read -r
  exit 1
fi
echo "  Node: $NODE_BIN"
echo

# ─── Bootstrap: install npm deps + Chromium if missing ───────────────
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

echo "  Starting batch... (Ctrl+C to abort)"
echo

cd "$PROJECT_DIR"
"$NODE_BIN" run.js
EXIT_CODE=$?

echo
echo "╔══════════════════════════════════════════════════════════════════╗"
if [ $EXIT_CODE -eq 0 ]; then
  echo "║  ✓ DONE (exit 0)                                                 ║"
else
  echo "║  ✗ FAILED (exit $EXIT_CODE)                                              ║"
fi
echo "║  Report: npm run report:today                                    ║"
echo "╚══════════════════════════════════════════════════════════════════╝"

if [ -t 0 ]; then : ; else
  echo
  echo "Press ENTER to close..."
  read -r
fi
