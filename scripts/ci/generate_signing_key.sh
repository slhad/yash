#!/usr/bin/env bash
set -euo pipefail

# Generate an RSA signing keypair for local testing. Writes private key and
# public key PEM files into the provided directory (default: tmp/).

OUT_DIR="${1:-tmp}"
mkdir -p "$OUT_DIR"

PRIV="$OUT_DIR/artifact_signing_key.pem"
PUB="$OUT_DIR/artifact-signing-public.pem"

if command -v openssl >/dev/null 2>&1; then
	echo "Generating RSA 4096-bit keypair -> $PRIV and $PUB"
	openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out "$PRIV"
	openssl pkey -in "$PRIV" -pubout -out "$PUB"
	chmod 600 "$PRIV"
	echo "WROTE private key: $PRIV"
	echo "WROTE public key: $PUB"
else
	echo "openssl not found; cannot generate keys" >&2
	exit 2
fi

exit 0
