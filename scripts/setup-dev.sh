#!/bin/sh
set -euo pipefail

# Simple developer setup script
# - Copies config.example.json to config.json if missing
# - Installs local git hooks (scripts/install-hooks.sh)
# Usage: sh scripts/setup-dev.sh

if [ ! -f "config.example.json" ]; then
	echo "config.example.json not found. Create config.example.json first or copy one from the repo." >&2
	exit 1
fi

if [ -f "config.json" ]; then
	echo "config.json already exists. Leaving in place. Do NOT commit config.json."
else
	cp config.example.json config.json
	echo "Created local config.json from config.example.json. Edit it locally and do not commit."
fi

if [ -d .git ] && [ -f scripts/install-hooks.sh ]; then
	echo "Installing git hooks..."
	sh scripts/install-hooks.sh
	echo "Git hooks installed."
else
	echo "Skipping hooks install (not a git repo or scripts/install-hooks.sh missing)."
fi

echo "Setup complete. Run 'bun install' to install dependencies (if needed)."
