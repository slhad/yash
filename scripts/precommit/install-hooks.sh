#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR=".githooks"
GIT_HOOKS_DIR=".git/hooks"

if [[ ! -d $GIT_HOOKS_DIR ]]; then
	echo "This repository does not appear to have a .git/hooks directory. Are you in the repo root?" >&2
	exit 1
fi

for hook in "$HOOK_DIR"/*; do
	hookName=$(basename "$hook")
	echo "Installing $hookName -> $GIT_HOOKS_DIR/$hookName"
	cp "$hook" "$GIT_HOOKS_DIR/$hookName"
	chmod +x "$GIT_HOOKS_DIR/$hookName"
done

echo "Hooks installed."
