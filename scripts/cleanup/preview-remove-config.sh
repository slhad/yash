#!/usr/bin/env bash
set -euo pipefail

# Helper to run the non-destructive preview steps for remove-config-history.sh
# It creates a mirror clone and attempts a filter in the mirror if git-filter-repo
# is available. This script never touches your current repo or remotes.

REPO_ROOT="$(pwd)"
TMPDIR=$(mktemp -d)
MIRROR="$TMPDIR/repo.git"

echo "Creating mirror clone at: $MIRROR"
git clone --mirror "$REPO_ROOT" "$MIRROR"

pushd "$MIRROR" >/dev/null
if command -v git-filter-repo >/dev/null 2>&1; then
	echo "git-filter-repo available; running preview filter in mirror (no push)"
	git filter-repo --invert-paths --path config.json || true
	echo "Preview filter completed in mirror. Inspect the mirror at: $MIRROR"
else
	echo "git-filter-repo not available. You can inspect the mirror and run the filter manually:"
	echo "  cd $MIRROR"
	echo "  git filter-repo --invert-paths --path config.json"
fi
popd >/dev/null

echo "Mirror creation finished. See $MIRROR for preview results."
