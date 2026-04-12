#!/bin/sh
set -euo pipefail

# scripts/purge-secrets.sh
# Prepare and optionally execute a history-purge using git-filter-repo.
#
# WARNING: Rewriting git history is destructive. This script only prepares
# the replacements file and prints the exact commands to run. To execute the
# destructive rewrite you must run this script with --execute AND set
# CONFIRM_PURGE=1 in your environment. Do NOT run without a full backup and
# coordination with repository owners.

usage() {
	cat <<'USAGE'
Usage: purge-secrets.sh --secrets-file secrets.txt [--mirror-dir /tmp/repo-mirror] [--execute]

Options:
  --secrets-file FILE  File with one secret or regex per line to remove/replace
  --mirror-dir DIR     Directory to create a mirror clone into (default: ./repo-mirror)
  --execute            If present AND CONFIRM_PURGE=1 is set, the script will run the purge

By default this script will prepare a replacements file and print the git-filter-repo
commands you should run manually. To perform the destructive purge automatically,
set CONFIRM_PURGE=1 and pass --execute. This is intentionally double-locked.
USAGE
}

SECRETS_FILE=""
MIRROR_DIR="./repo-mirror"
EXECUTE=0

while [ "$#" -gt 0 ]; do
	case "$1" in
	--secrets-file)
		SECRETS_FILE="$2"
		shift 2
		;;
	--mirror-dir)
		MIRROR_DIR="$2"
		shift 2
		;;
	--execute)
		EXECUTE=1
		shift 1
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "Unknown arg: $1"
		usage
		exit 2
		;;
	esac
done

if [ -z "$SECRETS_FILE" ]; then
	echo "Missing --secrets-file" >&2
	usage
	exit 2
fi

if [ ! -f "$SECRETS_FILE" ]; then
	echo "Secrets file not found: $SECRETS_FILE" >&2
	exit 2
fi

if [ -n "$(git status --porcelain)" ]; then
	echo "Working tree must be clean before preparing a purge. Commit or stash changes." >&2
	git status --porcelain
	exit 2
fi

REPLACE_FILE="replacements.txt"
rm -f "$REPLACE_FILE"
echo "# Generated replacements file for git-filter-repo / BFG" >"$REPLACE_FILE"
echo "# Each non-empty line will be replaced with the token ***REDACTED***" >>"$REPLACE_FILE"

while IFS= read -r line || [ -n "$line" ]; do
	line_trimmed=$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
	[ -z "$line_trimmed" ] && continue
	# Note: using exact literal replacement. For complex regex replacements consider
	# editing $REPLACE_FILE by hand or using git-filter-repo/BFG advanced options.
	printf '%s==>***REDACTED***\n' "$line_trimmed" >>"$REPLACE_FILE"
done <"$SECRETS_FILE"

echo "Prepared $REPLACE_FILE with replacements. Preview:"
sed -n '1,200p' "$REPLACE_FILE" || true

ORIGIN_URL=$(git config --get remote.origin.url || true)
if [ -z "$ORIGIN_URL" ]; then
	echo "Warning: remote origin not set. You will need to run this from a clone and supply the repo URL."
	ORIGIN_URL="<REPO_URL>"
fi

echo "\nDry-run: To purge secrets from repository history (manual steps), follow these steps:"
cat <<CMD
1. Make a local backup of your repository (clone it somewhere safe):
   git clone --mirror ${ORIGIN_URL} ${MIRROR_DIR}

2. Change directory into the mirror and run git-filter-repo with the replacements file:
   cd ${MIRROR_DIR}
   # Copy replacements.txt into the mirror parent or provide absolute path
   git filter-repo --replace-text ../${REPLACE_FILE}

3. Force-push rewritten history to the remote (VERY DESTRUCTIVE):
   git push --force --all
   git push --force --tags

4. Instruct all collaborators to re-clone the repository (their local clones will be incompatible).
   Inform collaborators that history was rewritten and that they must rebase or re-clone.

NOTE: The above commands are destructive. Do NOT run them until you have coordinated with repository owners
and rotated any exposed credentials.
CMD

if [ "$EXECUTE" -eq 1 ]; then
	if [ "${CONFIRM_PURGE:-0}" != "1" ]; then
		echo "Execution disabled: set CONFIRM_PURGE=1 in your environment to allow destructive execution." >&2
		exit 2
	fi

	if ! command -v git-filter-repo >/dev/null 2>&1; then
		echo "git-filter-repo not found in PATH. Please install it first (https://github.com/newren/git-filter-repo)." >&2
		exit 2
	fi

	echo "Starting destructive purge (this will rewrite history)."
	echo "Creating mirror clone: git clone --mirror ${ORIGIN_URL} ${MIRROR_DIR}"
	git clone --mirror "${ORIGIN_URL}" "${MIRROR_DIR}"
	cd "${MIRROR_DIR}"
	echo "Running git-filter-repo --replace-text ../${REPLACE_FILE}"
	git filter-repo --replace-text "../${REPLACE_FILE}"
	echo "Force-pushing rewritten history"
	git push --force --all
	git push --force --tags
	echo "Purge complete. Inform collaborators to re-clone the repository."
fi

echo "Done."
