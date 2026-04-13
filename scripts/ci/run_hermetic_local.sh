#!/usr/bin/env bash
set -euo pipefail

# Helper to reproduce the hermetic CI job locally and validate artifact collection.
# Usage:
#   ./scripts/ci/run_hermetic_local.sh    # builds image if missing and runs verify script
#   FORCE_BUILD=1 ./scripts/ci/run_hermetic_local.sh  # force rebuild

IMAGE_TAG="${IMAGE_TAG:-yash-ci:local}"
# By default pass host UID/GID as build args so the locally-built image can
# optionally create a host-matching user. Override by setting BUILD_ARGS in
# the environment before invoking this script (set to empty string to skip).
BUILD_ARGS="${BUILD_ARGS:---build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)}"
CONTAINER_NAME="${CONTAINER_NAME:-yash-ci-local-$(date +%s)}"

echo "Using image: $IMAGE_TAG"

# Build image if not present or if forced
if [ "${FORCE_BUILD:-0}" = "1" ] || [ -z "$(docker images -q "$IMAGE_TAG" 2>/dev/null)" ]; then
	echo "Building Docker image $IMAGE_TAG (this may take a while)..."
	# If BUILD_ARGS is non-empty, include them in the docker build invocation
	if [ -n "$BUILD_ARGS" ]; then
		eval docker build $BUILD_ARGS -t "$IMAGE_TAG" .
	else
		docker build -t "$IMAGE_TAG" .
	fi
else
	echo "Image $IMAGE_TAG already exists locally; skipping build. Set FORCE_BUILD=1 to rebuild."
fi

mkdir -p tmp

echo "Running verify script inside container to create artifacts under /app/tmp"
docker run --rm \
	-e HOST_UID="$(id -u)" \
	-e HOST_GID="$(id -g)" \
	-v "$(pwd)/tmp:/app/tmp" \
	--user "$(id -u):$(id -g)" \
	--name "$CONTAINER_NAME" \
	"$IMAGE_TAG" /bin/bash -lc 'bash scripts/ci/verify_artifact.sh'

echo "Local run finished — inspect tmp/ on host"
ls -la tmp || true
if [ -f tmp/ci-artifact-owner.txt ]; then
	echo "Artifact owner file contents:" && cat tmp/ci-artifact-owner.txt || true
fi

echo "If artifacts are present and ownership matches your host UID/GID, the CI artifact upload should succeed."
