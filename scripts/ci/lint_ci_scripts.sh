#!/usr/bin/env bash
set -euo pipefail

# Lightweight wrapper to run ShellCheck against the CI helper scripts.
# Writes results to tmp/ci-shellcheck.txt (tmp/ is gitignored) so the output
# is easy to inspect locally or in CI artifacts without failing the caller.

OUT_FILE="${1:-tmp/ci-shellcheck.txt}"
mkdir -p "$(dirname "$OUT_FILE")"

echo "ShellCheck run: $(date --iso-8601=seconds)" >"$OUT_FILE"

if ! command -v shellcheck >/dev/null 2>&1; then
	echo "ShellCheck not found on PATH." >>"$OUT_FILE"
	echo "Install on Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y shellcheck" >>"$OUT_FILE"
	echo "WROTE: $OUT_FILE"
	# Do not fail the caller; this is a low-risk helper.
	exit 0
fi

echo "Running: shellcheck -x scripts/ci/*.sh" >>"$OUT_FILE"
shellcheck -x scripts/ci/*.sh >>"$OUT_FILE" 2>&1 || true

echo "WROTE: $OUT_FILE"
exit 0
