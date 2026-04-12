#!/bin/sh
set -euo pipefail

# Simple readiness checklist for executing the destructive purge.
# This is non-destructive and only verifies prerequisites.

REPLACEMENTS_CANDIDATES="tmp/replacements-curated.txt tmp/replacements.txt"

echo "Purge readiness checklist"
echo "========================="

FOUND=0

# 1) Check replacements file exists and is non-empty
REPL_FILE=""
for f in $REPLACEMENTS_CANDIDATES; do
	if [ -f "$f" ] && [ -s "$f" ]; then
		REPL_FILE="$f"
		break
	fi
done

if [ -z "$REPL_FILE" ]; then
	echo "ERROR: No replacements file found. Create tmp/replacements-curated.txt or run scripts/prepare-purge-replacements.js"
	FOUND=1
else
	echo "Replacements file: $REPL_FILE"
	echo " - lines: $(wc -l <"$REPL_FILE" 2>/dev/null || echo 0)"
fi

# 2) Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
	echo "ERROR: Working tree not clean. Commit or stash changes before proceeding."
	git status --porcelain
	FOUND=1
else
	echo "Working tree: clean"
fi

# 3) Ensure remote origin is configured
ORIGIN_URL=$(git config --get remote.origin.url || true)
if [ -z "$ORIGIN_URL" ]; then
	echo "ERROR: remote.origin.url not set. Run this from a clone with a remote or set origin."
	FOUND=1
else
	echo "Remote origin: $ORIGIN_URL"
fi

# 4) Check git-filter-repo availability
if ! command -v git-filter-repo >/dev/null 2>&1; then
	echo "WARNING: git-filter-repo not found in PATH. Install it (https://github.com/newren/git-filter-repo) before executing the purge."
else
	echo "git-filter-repo: available"
fi

# 5) Confirm environment variable
if [ "${CONFIRM_PURGE:-0}" != "1" ]; then
	echo "NOTE: CONFIRM_PURGE is not set to 1. The purge script requires CONFIRM_PURGE=1 AND --execute to run destructively."
else
	echo "CONFIRM_PURGE=1 is set (destructive execution will be allowed by purge script)."
fi

if [ "$FOUND" -ne 0 ]; then
	echo "\nChecklist failed. Resolve errors above before attempting a destructive purge."
	exit 2
fi

echo "\nChecklist passed. Review tmp/replacements-curated.txt, rotate any exposed credentials, and coordinate with collaborators before running the destructive purge."
echo "Destructive command (example):"
echo "  CONFIRM_PURGE=1 sh scripts/purge-secrets.sh --secrets-file tmp/replacements-curated.txt --execute"

exit 0
