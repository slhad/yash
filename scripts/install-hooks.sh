#!/bin/sh
set -euo pipefail

# Installs the repository hooks into .git/hooks
HOOKS_DIR=".git/hooks"
mkdir -p "$HOOKS_DIR"

echo "Installing pre-commit hook..."
cp scripts/hooks/pre-commit "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "Hooks installed."
