#!/usr/bin/env bash
set -euo pipefail

# Run a full end-to-end local reproduction of the hermetic CI flow.
# Steps:
#  - build the hermetic image (with HOST_UID/HOST_GID build args)
#  - run the integration container and collect /app/tmp into host tmp/
#  - remediate and validate artifact ownership
#  - create numeric-owner tarball, generate checksums, verify tarball
#  - optionally sign and verify signatures (generate key locally with --generate-key)
#
# Usage: ./scripts/ci/run_full_local_ci.sh [--image NAME] [--force-build] [--no-sign] [--generate-key]

IMAGE="${IMAGE:-yash-ci:local}"
FORCE_BUILD=0
NO_SIGN=0
GENERATE_KEY=0

usage() {
	cat <<USAGE >&2
Usage: $0 [--image NAME] [--force-build] [--no-sign] [--generate-key]

Options:
  --image NAME       Override the image tag (default: yash-ci:local)
  --force-build      Force rebuilding the Docker image
  --no-sign          Skip signing step even if ARTIFACT_SIGNING_KEY is set
  --generate-key     Generate a temporary signing key under tmp/ and use it
  -h, --help         Show this help
USAGE
	exit 2
}

while [ $# -gt 0 ]; do
	case "$1" in
	--image)
		IMAGE="$2"
		shift 2
		;;
	--force-build)
		FORCE_BUILD=1
		shift
		;;
	--no-sign)
		NO_SIGN=1
		shift
		;;
	--generate-key)
		GENERATE_KEY=1
		shift
		;;
	-h | --help)
		usage
		;;
	*)
		echo "Unknown arg: $1" >&2
		usage
		;;
	esac
done

echo "Running full local CI reproduction"
echo "Image: $IMAGE"

if ! command -v docker >/dev/null 2>&1; then
	echo "docker not found in PATH; please install Docker and ensure you can run it." >&2
	exit 2
fi

BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)"

if [ "$FORCE_BUILD" -eq 1 ] || [ -z "$(docker images -q "$IMAGE" 2>/dev/null)" ]; then
	echo "Building Docker image $IMAGE (this may take a while)..."
	docker build $BUILD_ARGS -t "$IMAGE" .
else
	echo "Image $IMAGE already present; skipping build. Use --force-build to rebuild."
fi

mkdir -p tmp

echo "Running integration container and collecting artifacts (wrapper will copy tmp/ back to host)"
chmod +x scripts/ci/run_and_collect_artifacts.sh scripts/ci/container_run.sh || true

# Allow the container run to fail (we still want to collect artifacts and run remediation)
set +e
./scripts/ci/run_and_collect_artifacts.sh "$IMAGE" -- "bash scripts/ci/container_run.sh"
RUN_EXIT=$?
set -e

echo "Container run finished (exit code: $RUN_EXIT). Proceeding with remediation & artifact pipeline"

echo "Remediate and validate artifacts..."
chmod +x scripts/ci/remediate_and_validate_artifacts.sh || true
if ./scripts/ci/remediate_and_validate_artifacts.sh tmp "$(id -u)" "$(id -g)"; then
	echo "Remediation/validation succeeded"
else
	echo "Remediation/validation failed; inspect tmp/ for diagnostics" >&2
	# Continue to create tarball and diagnostics to aid debugging
fi

echo "Creating numeric-owner tarball"
chmod +x scripts/ci/create_artifact_tar.sh || true
./scripts/ci/create_artifact_tar.sh tmp || echo "Tarball creation failed"

echo "Generating checksums"
chmod +x scripts/ci/generate_artifact_checksums.sh || true
./scripts/ci/generate_artifact_checksums.sh tmp || echo "Checksum generation failed"

# Find created tarball
TARFILE=$(ls tmp/integration-artifacts-*.tar.gz 2>/dev/null | head -n1 || true)
if [ -z "$TARFILE" ]; then
	echo "No tarball found under tmp/; aborting verification step" >&2
else
	echo "Verifying tarball against manifest and checksums: $TARFILE"
	chmod +x scripts/ci/verify_tarball_against_manifest.sh || true
	if ./scripts/ci/verify_tarball_against_manifest.sh "$TARFILE" tmp/artifact-manifest.json tmp/artifact-checksums.json; then
		echo "Tarball verification succeeded"
	else
		echo "Tarball verification failed; inspect tmp/ for reports" >&2
	fi
fi

# Optional signing
if [ "$NO_SIGN" -eq 1 ]; then
	echo "Skipping signing as requested (--no-sign)"
else
	if [ "$GENERATE_KEY" -eq 1 ]; then
		echo "Generating temporary signing key under tmp/"
		chmod +x scripts/ci/generate_signing_key.sh || true
		./scripts/ci/generate_signing_key.sh tmp
		export ARTIFACT_SIGNING_KEY="$(cat tmp/artifact_signing_key.pem)"
	fi

	if [ -n "${ARTIFACT_SIGNING_KEY:-}" ]; then
		echo "Signing artifacts using ARTIFACT_SIGNING_KEY"
		chmod +x scripts/ci/sign_artifacts.sh || true
		./scripts/ci/sign_artifacts.sh tmp || echo "Signing step failed"

		# Verify signatures using generated public key; use --no-ownership to avoid host chown
		if [ -n "$TARFILE" ]; then
			echo "Verifying signatures for $TARFILE"
			chmod +x scripts/ci/verify_signatures_and_restore.sh || true
			./scripts/ci/verify_signatures_and_restore.sh "$TARFILE" --pubkey tmp/artifact-signing-public.pem --no-ownership || echo "Signature verification failed"
		else
			echo "No tarball to verify signatures against"
		fi
	else
		echo "No ARTIFACT_SIGNING_KEY present; skipping signing step"
	fi
fi

echo "Full run complete. Inspect tmp/ for artifacts, manifests, checksums, signatures, and reports."
echo "Container run exit code: $RUN_EXIT"

exit $RUN_EXIT
