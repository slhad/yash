#!/usr/bin/env bash
set -euo pipefail

# Sign artifacts (tarball, manifest, checksums) using an RSA private key
# supplied via the ARTIFACT_SIGNING_KEY environment variable (PEM). The
# script writes the private key to a temporary file and produces detached
# binary signatures and base64 ASCII signatures (.sig and .sig.asc) next to
# each artifact. It also exports a public key (PEM) for verification.

TARGET_DIR="${1:-tmp}"
KEY_ENV="${ARTIFACT_SIGNING_KEY:-}"
KEY_FILE="/tmp/artifact_signing_key.pem"
PUB_FILE="$TARGET_DIR/artifact-signing-public.pem"

echo "sign_artifacts: target=$TARGET_DIR"

if [ -z "$KEY_ENV" ]; then
	echo "ARTIFACT_SIGNING_KEY not provided; skipping artifact signing"
	exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
	echo "openssl not available in PATH; cannot sign artifacts" >&2
	exit 1
fi

# Write private key securely
umask 077
printf '%s' "$KEY_ENV" >"$KEY_FILE"
chmod 600 "$KEY_FILE"

# Export public key for consumers to verify signatures
openssl pkey -in "$KEY_FILE" -pubout -out "$PUB_FILE" 2>/dev/null || true
echo "WROTE public key: $PUB_FILE"

shopt -s nullglob
signed_any=0

# Sign tarballs
for tar in "$TARGET_DIR"/integration-artifacts-*.tar.gz; do
	if [ -f "$tar" ]; then
		echo "Signing tarball: $tar"
		sig="$tar.sig"
		asc="$tar.sig.asc"
		openssl dgst -sha256 -sign "$KEY_FILE" -out "$sig" "$tar"
		openssl base64 -in "$sig" -out "$asc"
		echo "WROTE: $sig and $asc"
		signed_any=1
	fi
done

# Sign manifest and checksums if present
for f in "$TARGET_DIR"/artifact-manifest.json "$TARGET_DIR"/artifact-checksums.json "$TARGET_DIR"/ci-env.txt; do
	if [ -f "$f" ]; then
		echo "Signing file: $f"
		sig="$f.sig"
		asc="$f.sig.asc"
		openssl dgst -sha256 -sign "$KEY_FILE" -out "$sig" "$f"
		openssl base64 -in "$sig" -out "$asc"
		echo "WROTE: $sig and $asc"
		signed_any=1
	fi
done

if [ "$signed_any" -eq 0 ]; then
	echo "No artifacts found to sign in $TARGET_DIR"
else
	echo "Artifact signing complete"
fi

# Clean up private key file
rm -f "$KEY_FILE"

exit 0
