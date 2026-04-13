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

echo "Attempting chown $TARGET_DIR -> $OWNER without sudo"
if chown -R "$OWNER" "$TARGET_DIR" 2>/dev/null; then
	echo "chown succeeded"
else
	echo "chown without sudo failed; checking for non-interactive sudo"
	if command -v sudo >/dev/null 2>&1; then
		# Check if sudo is usable non-interactively (passwordless)
		if sudo -n true >/dev/null 2>&1; then
			echo "Attempting non-interactive sudo chown"
			if sudo chown -R "$OWNER" "$TARGET_DIR"; then
				echo "sudo chown succeeded"
			else
				echo "sudo chown failed; continuing"
			fi
		else
			echo "sudo present but requires interactive password; cannot auto-chown in this environment."
			echo "To remediate run as a user with privileges: sudo chown -R $OWNER $TARGET_DIR"
		fi
	else
		echo "No sudo available and chown failed; attempting remediation via Docker container (bind-mount)"
		if command -v docker >/dev/null 2>&1; then
			# Use a small base image with chown (busybox) to run as root inside the
			# container and chown the mounted host directory. This avoids requiring
			# interactive sudo on the host and works on runners that can run docker.
			HELPER_IMAGE="busybox:1.36.1"
			echo "Attempting docker-based chown using image: $HELPER_IMAGE"
			if docker run --rm -v "$(pwd)/$TARGET_DIR:/host_tmp" "$HELPER_IMAGE" sh -c "chown -R $OWNER /host_tmp"; then
				echo "Docker-based chown succeeded"
			else
				echo "Docker-based chown failed; cannot remediate automatically"
				echo "To remediate run as root or on a runner with appropriate permissions: chown -R $OWNER $TARGET_DIR"
			fi
		else
			echo "No docker available and chown failed; cannot remediate automatically."
			echo "To remediate run as root or on a runner with appropriate permissions: chown -R $OWNER $TARGET_DIR"
		fi
	fi
fi

echo "Post-fix listing:"
ls -la "$TARGET_DIR" || true
