#!/usr/bin/env bash
set -euo pipefail

echo "Verifying artifact mount and ownership inside container"

# Ensure the mounted artifact directory exists
mkdir -p /app/tmp

ARTIFACT=/app/tmp/ci-artifact.txt
echo "artifact created at $(date --iso-8601=seconds)" >"$ARTIFACT"

echo "WROTE: $ARTIFACT"
ls -l /app/tmp || true

if command -v stat >/dev/null 2>&1; then
	stat -c 'file=%n uid=%u gid=%g mode=%a' "$ARTIFACT" || true
fi

echo "User inside container: $(id -u):$(id -g)"

echo "Done"
