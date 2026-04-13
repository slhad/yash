#!/usr/bin/env bash
set -euo pipefail

# Create a compressed tarball of the collected artifacts under TARGET_DIR.
# The tarball will include numeric owner metadata so the archive preserves
# UID/GID/mode information for later inspection or extraction.

TARGET_DIR="${1:-tmp}"
OUT="${2:-$TARGET_DIR/integration-artifacts-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}"

if [ ! -d "$TARGET_DIR" ]; then
	echo "Target directory '$TARGET_DIR' does not exist" >&2
	exit 1
fi

if [ ! -f "$TARGET_DIR/artifact-manifest.json" ]; then
	echo "artifact-manifest.json not present, generating..."
	if [ -x scripts/ci/generate_artifact_manifest.sh ]; then
		scripts/ci/generate_artifact_manifest.sh "$TARGET_DIR"
	else
		echo "generate_artifact_manifest.sh missing or not executable; continuing without manifest" >&2
	fi
fi

echo "Creating tarball with numeric owner metadata: $OUT"
# Use --numeric-owner so extraction tools that respect this flag can restore
# numeric owners. We change directory into the target dir to ensure tar stores
# relative paths.
tar --numeric-owner -C "$TARGET_DIR" -czf "$OUT" .

echo "WROTE: $OUT"
ls -lah "$OUT" || true

exit 0
