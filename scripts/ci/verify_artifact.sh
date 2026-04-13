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

# Also write a small owner file that the host can inspect after the container exits.
# This is useful when containers are run with different UIDs/GIDs and we need to
# quickly verify ownership on the host side.
ARTIFACT_OWNER=/app/tmp/ci-artifact-owner.txt
if command -v stat >/dev/null 2>&1; then
	OWNER=$(stat -c '%u:%g' "$ARTIFACT" || true)
else
	OWNER="$(id -u):$(id -g)"
fi
echo "$OWNER" >"$ARTIFACT_OWNER" || true
echo "WROTE OWNER FILE: $ARTIFACT_OWNER -> $(cat "$ARTIFACT_OWNER" 2>/dev/null || echo 'n/a')"

# If the CI runner passes HOST_UID and HOST_GID environment variables, attempt to
# chown the artifact directory so files are owned by the host user. This will
# only succeed when the script runs as a privileged user inside the container.
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
	echo "HOST_UID/GID provided: $HOST_UID:$HOST_GID - attempting chown of /app/tmp"
	if chown -R "$HOST_UID":"$HOST_GID" /app/tmp 2>/dev/null; then
		echo "Chown successful"
	else
		echo "Chown failed or not permitted (container likely running as non-root); continuing"
	fi
fi
