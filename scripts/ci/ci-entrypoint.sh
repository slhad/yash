#!/usr/bin/env bash
set -euo pipefail

# Entrypoint used in CI/hermetic runs. Behaviors:
# - If HOST_UID/HOST_GID are provided and this entrypoint runs as root, try to
#   create a matching user/group inside the container and run the command as
#   that user. This helps ensure files written into mounted volumes are owned
#   by the host user (useful for CI artifact mounting scenarios).
# - If HOST_UID/HOST_GID are provided but we're not root, attempt a best-effort
#   chown of /app/tmp and then run the command as-is.
# - If HOST_UID/HOST_GID are not provided, just exec the given command.

if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
	echo "ci-entrypoint: HOST_UID/HOST_GID provided -> $HOST_UID:$HOST_GID"
	mkdir -p /app/tmp || true

	# Ensure common binary locations and Playwright browser path are available
	# for non-root executions. These are set here so when we drop privileges using
	# gosu/su or when the container is run with --user the environment is sane.
	export PATH="/usr/local/bin:/root/.bun/bin:${PATH}"
	export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright-browsers}"

	# If running as root we can create a user/group matching the host UID/GID
	# and then drop privileges to that user to execute the passed command.
	if [ "$(id -u)" -eq 0 ]; then
		# Create group if it doesn't exist
		if ! getent group hostgroup >/dev/null 2>&1; then
			groupadd -g "$HOST_GID" hostgroup 2>/dev/null || true
		fi

		# Create user if it doesn't exist; home under /home/hostuser
		if ! id -u hostuser >/dev/null 2>&1; then
			useradd -u "$HOST_UID" -g "$HOST_GID" -m -d /home/hostuser -s /bin/bash hostuser 2>/dev/null || true
		fi

		# Attempt to set ownership of artifact dir to host UID/GID
		chown -R "$HOST_UID":"$HOST_GID" /app/tmp 2>/dev/null || true

		# Execute the requested command as the created user. Prefer gosu (fast
		# and reliable), fall back to su if present, otherwise run as root. Ensure
		# the runtime PATH and PLAYWRIGHT_BROWSERS_PATH are available to the
		# non-root user by exporting them in the executed shell.
		cmd="$*"
		if command -v gosu >/dev/null 2>&1; then
			echo "Executing command as hostuser (UID:GID $HOST_UID:$HOST_GID) using gosu"
			# Use bash -lc so we can export environment variables before running
			# the user's command. Use an explicit PATH so /usr/local/bin and bun
			# are found even when running as a non-root user.
			exec gosu hostuser bash -lc "export PATH=/usr/local/bin:/root/.bun/bin:\$PATH; export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}; $cmd"
		elif command -v su >/dev/null 2>&1; then
			echo "Executing command as hostuser (UID:GID $HOST_UID:$HOST_GID) using su"
			exec su -s /bin/bash hostuser -c "export PATH=/usr/local/bin:/root/.bun/bin:\$PATH; export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}; $cmd"
		else
			echo "No gosu or su available; running command as root"
			exec "$@"
		fi
	else
		# Not root: best-effort chown then run command. Export PATH and
		# PLAYWRIGHT_BROWSERS_PATH so runtime tools are available even when the
		# container was started with --user.
		chown -R "$HOST_UID":"$HOST_GID" /app/tmp 2>/dev/null || true
		export PATH="/usr/local/bin:/root/.bun/bin:${PATH}"
		export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright-browsers}"
	fi
fi

# Default: run the passed command
exec "$@"
