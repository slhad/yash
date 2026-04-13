#!/usr/bin/env bash
set -euo pipefail

# Launch a container from the given image, run the provided command inside it,
# then reliably collect /app/tmp into the host tmp/ directory. This wrapper is
# intended for deterministic local reproduction and CI wrapper usage.
#
# The wrapper supports an optional environment variable BAKE_USER. When
# BAKE_USER=true the container will NOT be run with the host --user flag and
# assumes the image either bakes a host-matching user or will handle ownership
# inside the container. Default (unset) preserves the original behavior of
# running the container as the host runner UID:GID (recommended default).
#
# Usage: scripts/ci/run_and_collect_artifacts.sh <image> -- <command to run inside container>

IMAGE="${1:-yash-ci:local}"
shift || true
if [ "$#" -eq 0 ]; then
	echo "Usage: $0 <image> -- <command>" >&2
	exit 2
fi

if [ "$1" = "--" ]; then
	shift
fi

CMD="$*"

CONTAINER_NAME="yash-ci-run-$(date +%s)-$RANDOM"

echo "[run_and_collect_artifacts] Image: $IMAGE"
echo "[run_and_collect_artifacts] Container: $CONTAINER_NAME"

mkdir -p tmp

echo "Starting container (detached) and running command inside it"

# If BAKE_USER is set to 'true', do not pass --user so the baked image's user
# (if present) will run the command. Otherwise run the container as the current
# host user to make artifact ownership immediate on the host.
BAKE_USER="${BAKE_USER:-false}"
if [ "$BAKE_USER" = "true" ]; then
	echo "Running container without --user (bake-user path)"
	docker run -d --name "$CONTAINER_NAME" \
		-e RUN_PLAYWRIGHT=1 \
		-e HOST_UID="$(id -u)" \
		-e HOST_GID="$(id -g)" \
		-v "$(pwd)/tmp:/app/tmp" \
		"$IMAGE" /bin/bash -lc "$CMD"
else
	echo "Running container with --user $(id -u):$(id -g) (runtime --user path)"
	docker run -d --name "$CONTAINER_NAME" \
		-e RUN_PLAYWRIGHT=1 \
		-e HOST_UID="$(id -u)" \
		-e HOST_GID="$(id -g)" \
		-v "$(pwd)/tmp:/app/tmp" \
		--user "$(id -u):$(id -g)" \
		"$IMAGE" /bin/bash -lc "$CMD"
fi

echo "Waiting for container to finish..."
docker wait "$CONTAINER_NAME" >/dev/null

RUN_EXIT=$(docker inspect --format='{{.State.ExitCode}}' "$CONTAINER_NAME" 2>/dev/null || echo 1)
echo "Container $CONTAINER_NAME exited with code $RUN_EXIT"

echo "Copying artifacts from container to host tmp/ using docker cp"
mkdir -p tmp
if docker cp "$CONTAINER_NAME":/app/tmp/. tmp/ 2>/dev/null; then
	echo "docker cp succeeded"
else
	echo "docker cp failed; attempting fallback copy using docker exec and tar (may fail if container exited)"
	# Attempt to stream a tarball from the container; this will fail if the container is gone
	if docker exec "$CONTAINER_NAME" tar -C /app/tmp -cf - . >tmp/tmp.tar 2>/dev/null; then
		echo "Fallback tar created tmp/tmp.tar; extracting"
		tar -C tmp -xf tmp/tmp.tar && rm -f tmp/tmp.tar || true
	else
		echo "Fallback tar also failed; artifacts may not be present"
	fi
fi

echo "Removing container $CONTAINER_NAME"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "Running host-side fixer to ensure artifact ownership (if present)"
if [ -f scripts/ci/fix_host_artifact_ownership.sh ]; then
	bash scripts/ci/fix_host_artifact_ownership.sh tmp || echo "fixer failed or not permitted"
else
	echo "No host-side fixer found; skipping"
fi

echo "Final tmp/ listing"
ls -la tmp || true

exit "$RUN_EXIT"
