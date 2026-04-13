#!/usr/bin/env bash
set -euo pipefail

# Remediate and validate artifact ownership after collection into tmp/
# Usage: ./scripts/ci/remediate_and_validate_artifacts.sh [target_dir] [expected_uid] [expected_gid]

TARGET_DIR="${1:-tmp}"
EXPECTED_UID="${2:-$(id -u)}"
EXPECTED_GID="${3:-$(id -g)}"

MANIFEST="$TARGET_DIR/artifact-manifest.json"

echo "Remediate+Validate artifacts in: $TARGET_DIR (expected $EXPECTED_UID:$EXPECTED_GID)"

chmod +x scripts/ci/generate_artifact_manifest.sh scripts/ci/validate_artifact_manifest.sh scripts/ci/fix_host_artifact_ownership.sh || true

echo "Generating manifest..."
./scripts/ci/generate_artifact_manifest.sh "$TARGET_DIR"

echo "Validating manifest..."
if ./scripts/ci/validate_artifact_manifest.sh "$MANIFEST" "$EXPECTED_UID" "$EXPECTED_GID"; then
	echo "Validation passed: artifacts owned by $EXPECTED_UID:$EXPECTED_GID"
	exit 0
fi

echo "Validation failed; attempting remediation using host fixer"
if ./scripts/ci/fix_host_artifact_ownership.sh "$TARGET_DIR"; then
	echo "Remediation attempted; regenerating manifest"
	./scripts/ci/generate_artifact_manifest.sh "$TARGET_DIR"
	if ./scripts/ci/validate_artifact_manifest.sh "$MANIFEST" "$EXPECTED_UID" "$EXPECTED_GID"; then
		echo "Remediation succeeded: artifacts now owned by $EXPECTED_UID:$EXPECTED_GID"
		exit 0
	else
		echo "Remediation did not resolve ownership mismatches; see tmp/artifact-ownership-report.txt"
		exit 2
	fi
else
	echo "Host-side fixer failed or not permitted; cannot remediate" >&2
	exit 3
fi
