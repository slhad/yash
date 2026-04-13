#!/usr/bin/env bash
set -euo pipefail

# Verify signatures (if present) for the artifact tarball and internal files,
# extract the tarball, and optionally restore numeric ownerships based on the
# embedded artifact-manifest.json. This is a consumer/CI-side helper that
# combines verification and restoration in a single step.

usage() {
	cat <<USAGE >&2
Usage: $0 <tarball> [--pubkey <pubkey.pem>] [--dest <dest_dir>] [--no-ownership]

Examples:
  $0 tmp/integration-artifacts-*.tar.gz --pubkey tmp/artifact-signing-public.pem
  $0 tmp/integration-artifacts-*.tar.gz --dest restored/ --no-ownership
USAGE
	exit 2
}

if [ $# -lt 1 ]; then
	usage
fi

TARFILE=""
PUBKEY=""
DEST_DIR=""
NO_OWNERSHIP=false

TARFILE="$1"
shift || true

while [ $# -gt 0 ]; do
	case "$1" in
	--pubkey)
		PUBKEY="$2"
		shift 2
		;;
	--dest)
		DEST_DIR="$2"
		shift 2
		;;
	--no-ownership)
		NO_OWNERSHIP=true
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

if [ ! -f "$TARFILE" ]; then
	echo "Tarball not found: $TARFILE" >&2
	exit 2
fi

DEST_DIR="${DEST_DIR:-./tmp/restored-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$DEST_DIR"

WORKDIR=$(pwd)
REPORT="$DEST_DIR/signature-verification-report.json"
echo "{\"tarball\": \"$TARFILE\", \"checks\": []}" >"$REPORT"

verify_sig_with_pubkey() {
	local file="$1"
	local sigfile="$2"
	local pubkey="$3"
	# sigfile may be .sig (binary) or .sig.asc (base64)
	if [ ! -f "$sigfile" ]; then
		echo "no-signature"
		return 2
	fi
	if [[ "$sigfile" == *.asc ]]; then
		tmp=$(mktemp)
		base64 -d "$sigfile" >"$tmp"
		if openssl dgst -sha256 -verify "$pubkey" -signature "$tmp" "$file" >/dev/null 2>&1; then
			rm -f "$tmp"
			echo "verified"
			return 0
		else
			rm -f "$tmp"
			echo "bad"
			return 3
		fi
	else
		if openssl dgst -sha256 -verify "$pubkey" -signature "$sigfile" "$file" >/dev/null 2>&1; then
			echo "verified"
			return 0
		else
			echo "bad"
			return 3
		fi
	fi
}

# Step 1: if an external tar signature exists next to the tar, try to verify it
TAR_SIG_BIN="$TARFILE.sig"
TAR_SIG_ASC="$TARFILE.sig.asc"
tar_signed=false
if [ -f "$TAR_SIG_BIN" ] || [ -f "$TAR_SIG_ASC" ]; then
	tar_signed=true
	echo "Found external tar signature for $TARFILE"
	# Determine pubkey to use: explicit, or co-located public key, or fail
	if [ -z "$PUBKEY" ]; then
		# look for public key next to tar
		candidate_dir=$(dirname "$TARFILE")
		if [ -f "$candidate_dir/artifact-signing-public.pem" ]; then
			PUBKEY="$candidate_dir/artifact-signing-public.pem"
		fi
	fi
	if [ -z "$PUBKEY" ] || [ ! -f "$PUBKEY" ]; then
		echo "No public key available to verify tar signature; expected --pubkey or artifact-signing-public.pem next to tar" >&2
		echo "{\"error\": \"no_pubkey_for_tar_signature\"}" >"$REPORT"
		exit 3
	fi
	chosen_sig="$([ -f "$TAR_SIG_BIN" ] && echo "$TAR_SIG_BIN" || echo "$TAR_SIG_ASC")"
	echo "Verifying tar signature using pubkey: $PUBKEY"
	if verify_sig_with_pubkey "$TARFILE" "$chosen_sig" "$PUBKEY"; then
		echo "Tar signature verified"
	else
		echo "Tar signature verification failed" >&2
		echo "{\"error\": \"tar_signature_failed\"}" >"$REPORT"
		exit 4
	fi
fi

# Step 2: If there was no external tar signature, or even if there was, extract
# the tarball into DEST_DIR so we can verify internal signatures (manifest, checksums)
echo "Extracting tarball to $DEST_DIR"
tar -xzf "$TARFILE" -C "$DEST_DIR"

# If PUBKEY not set, try to find public key inside extracted content
if [ -z "$PUBKEY" ] && [ -f "$DEST_DIR/artifact-signing-public.pem" ]; then
	PUBKEY="$DEST_DIR/artifact-signing-public.pem"
fi

if [ -z "$PUBKEY" ] || [ ! -f "$PUBKEY" ]; then
	echo "Warning: no public key available for internal signature verification; skipping signature checks" >&2
	echo "{\"warning\": \"no_pubkey_found_internal\"}" >"$REPORT"
else
	# Verify internal files: manifest, checksums, ci-env.txt
	failures=0
	for f in artifact-manifest.json artifact-checksums.json ci-env.txt; do
		file="$DEST_DIR/$f"
		if [ -f "$file" ]; then
			sigbin="$file.sig"
			sigasc="$file.sig.asc"
			if [ -f "$sigbin" ] || [ -f "$sigasc" ]; then
				sigfile="$([ -f "$sigbin" ] && echo "$sigbin" || echo "$sigasc")"
				echo "Verifying signature for $f"
				if verify_sig_with_pubkey "$file" "$sigfile" "$PUBKEY"; then
					echo "Verified $f" >>"$REPORT"
				else
					echo "Signature verification failed for $f" >>"$REPORT"
					failures=$((failures + 1))
				fi
			else
				echo "No signature file for $f" >>"$REPORT"
				failures=$((failures + 1))
			fi
		else
			echo "File $f not present inside tar; skipping" >>"$REPORT"
		fi
	done
	if [ $failures -ne 0 ]; then
		echo "Signature verification failures: $failures" >&2
		echo "{\"error\": \"signature_verification_failed\", \"failures\": $failures}" >"$REPORT"
		exit 5
	fi
fi

echo "Signature verification (if performed) succeeded. Proceeding to restoration step."

# Step 3: Restore ownership (delegate to existing helper which also extracts)
if [ "$NO_OWNERSHIP" = true ]; then
	echo "Skipping ownership restoration (--no-ownership)"
	exit 0
fi

echo "Running extract_and_restore_artifacts to perform extraction+ownership restoration"
chmod +x scripts/ci/extract_and_restore_artifacts.sh || true
if scripts/ci/extract_and_restore_artifacts.sh "$TARFILE" "$DEST_DIR"; then
	echo "Extraction and ownership restoration succeeded"
	exit 0
else
	echo "Extraction/restoration failed" >&2
	exit 6
fi
