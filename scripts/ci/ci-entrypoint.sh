#!/usr/bin/env bash
set -euo pipefail

# Entrypoint used in CI/hermetic runs. If HOST_UID and HOST_GID are provided,
# attempt to chown /app/tmp so artifacts written there are owned by the host user.
# Then exec the passed command.

if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
	echo "ci-entrypoint: HOST_UID/HOST_GID provided -> $HOST_UID:$HOST_GID"
	mkdir -p /app/tmp || true
	# attempt recursive chown; ignore failures
	chown -R "$HOST_UID":"$HOST_GID" /app/tmp 2>/dev/null || true
fi

exec "$@"
