#!/usr/bin/env bash
set -euo pipefail

# Fix ownership of files under tmp/ created by hermetic container runs so the CI
# runner can upload them as artifacts. Intended to be run on the host (CI
# runner) after docker cp or container exit. It will use tmp/ci-artifact-owner.txt
# when present, otherwise default to the current runner UID:GID.

TARGET_DIR="${1:-tmp}"
OWNER_FILE="$TARGET_DIR/ci-artifact-owner.txt"

if [ -f "$OWNER_FILE" ]; then
	OWNER=$(cat "$OWNER_FILE")
	echo "Found owner file: $OWNER_FILE -> $OWNER"
else
	OWNER="$(id -u):$(id -g)"
	echo "No owner file found; defaulting to runner owner: $OWNER"
fi

if command -v sudo >/dev/null 2>&1; then
	echo "Attempting to chown $TARGET_DIR -> $OWNER using sudo"
	sudo chown -R "$OWNER" "$TARGET_DIR" || echo "sudo chown failed; continuing"
else
	echo "Attempting to chown $TARGET_DIR -> $OWNER (no sudo)"
	chown -R "$OWNER" "$TARGET_DIR" 2>/dev/null || echo "chown failed or not permitted; continuing"
fi

echo "Post-fix listing:"
ls -la "$TARGET_DIR" || true
