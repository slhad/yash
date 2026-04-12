#!/usr/bin/env bash
# Generate purge evidence artifacts (non-secret metadata only)
# Usage: sh scripts/generate-purge-evidence.sh --mirror-dir <mirror> --sim-dir <sim>

set -euo pipefail

MIRROR_DIR=""
SIM_DIR=""

while [ "$#" -gt 0 ]; do
	case "$1" in
	--mirror-dir)
		MIRROR_DIR="$2"
		shift 2
		;;
	--sim-dir)
		SIM_DIR="$2"
		shift 2
		;;
	-h | --help)
		echo "Usage: $0 --mirror-dir <mirror> --sim-dir <sim>"
		exit 0
		;;
	*)
		echo "Unknown arg: $1"
		exit 1
		;;
	esac
done

if [ -z "$MIRROR_DIR" ] || [ -z "$SIM_DIR" ]; then
	echo "--mirror-dir and --sim-dir are required" >&2
	exit 2
fi

mkdir -p tmp/evidence

echo "[evidence] Generating pre-sim commit manifest"
git --git-dir="$MIRROR_DIR" log --pretty=format:'%H %an %ad %s' --date=iso >tmp/evidence/commit-manifest.pre-sim.txt

echo "[evidence] Generating post-sim commit manifest"
git --git-dir="$SIM_DIR" log --pretty=format:'%H %an %ad %s' --date=iso >tmp/evidence/commit-manifest.post-sim.txt

echo "[evidence] Generating tree manifests (top-level checksums)"
git --git-dir="$MIRROR_DIR" ls-tree -r --name-only HEAD | sort | xargs -I{} sh -c "git --git-dir=$MIRROR_DIR hash-object $MIRROR_DIR/{} 2>/dev/null || true" | sort >tmp/evidence/tree-manifest.pre-sim.txt || true
git --git-dir="$SIM_DIR" ls-tree -r --name-only HEAD | sort | xargs -I{} sh -c "git --git-dir=$SIM_DIR hash-object $SIM_DIR/{} 2>/dev/null || true" | sort >tmp/evidence/tree-manifest.post-sim.txt || true

if [ -f "tmp/repo-mirror-backup.tar.gz" ]; then
	sha256sum tmp/repo-mirror-backup.tar.gz >tmp/evidence/mirror-backup.sha256
fi

if command -v gpg >/dev/null 2>&1; then
	echo "[evidence] Signing artifacts with GPG (if available)"
	for f in tmp/evidence/*.txt tmp/evidence/*.sha256; do
		gpg --armor --detach-sign --output "$f.asc" --yes "$f" || true
	done
fi

echo "[evidence] Evidence generated in tmp/evidence/"
