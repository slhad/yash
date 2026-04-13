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

# Write a CI environment diagnostic file to help debug image/runtime issues.
# This includes versions and paths for bun/node/npx/gosu and Playwright browser
# installation layout so the host CI can quickly inspect image health.
CI_ENV=/app/tmp/ci-env.txt
{
	echo "ci-env generated at: $(date --iso-8601=seconds)"
	echo "User: $(id -u):$(id -g) $(id -un 2>/dev/null || true)"
	echo "PATH=$PATH"
	echo "which bun: $(command -v bun 2>/dev/null || echo 'n/a')"
	echo "bun --version: $(bun --version 2>/dev/null || echo 'n/a')"
	echo "node --version: $(node --version 2>/dev/null || echo 'n/a')"
	echo "npx --version: $(npx --version 2>/dev/null || echo 'n/a')"
	if command -v gosu >/dev/null 2>&1; then
		echo "gosu --version: $(gosu --version 2>/dev/null || echo 'unknown')"
	else
		echo "gosu: not installed"
	fi
	echo "ls -la /usr/local/bin/bun:"
	ls -la /usr/local/bin/bun 2>/dev/null || echo "n/a"
	if [ -d "/ms-playwright-browsers" ]; then
		echo "/ms-playwright-browsers: present"
		ls -la /ms-playwright-browsers | sed -n '1,200p' || true
	else
		echo "/ms-playwright-browsers: not present"
	fi
	if [ -d "/root/.bun" ]; then
		echo "/root/.bun: present"
		ls -la /root/.bun | sed -n '1,200p' || true
	else
		echo "/root/.bun: not present"
	fi
	echo "Available disk space:"
	df -h || true
} >"$CI_ENV" 2>&1 || true
echo "WROTE CI ENV FILE: $CI_ENV -> $(sed -n '1,200p' "$CI_ENV" 2>/dev/null || echo 'n/a')"
