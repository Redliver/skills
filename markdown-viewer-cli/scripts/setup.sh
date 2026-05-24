#!/usr/bin/env bash
# markdown-viewer-cli Setup Script (macOS/Linux)
# Detects skill location automatically and installs dependencies
set -euo pipefail

# Determine script directory — scripts/ *is* the CLI dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$SCRIPT_DIR"
SKILL_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Setting up markdown-viewer-cli..."
echo "  Skill root: $SKILL_ROOT"
echo "  CLI dir:    $CLI_DIR"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is required (v18+). Install from https://nodejs.org" >&2
  exit 1
fi
echo "  Node.js $(node --version) detected"

# Install dependencies
echo "  Installing npm dependencies..."
cd "$CLI_DIR"
npm install --no-fund --no-audit
echo "  Dependencies installed"

# Make launcher executable
chmod +x "$CLI_DIR/mdv"

# Make root-level launcher executable
chmod +x "$SKILL_ROOT/mdv"

echo ""
echo "Setup complete! Usage:"
echo "  cd $SKILL_ROOT && ./mdv render file.md --view"
echo "  ./mdv convert file.md -t academic"
echo "  ./mdv themes"
echo ""
echo "Tip: Add this directory to your PATH for system-wide access:"
echo "  export PATH=\"\$PATH:$SKILL_ROOT\""
