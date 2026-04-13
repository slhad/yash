#!/usr/bin/env bash
set -euo pipefail

# remove-config-history.sh
#
# Safe helper to *prepare* and optionally run a git history rewrite that
# removes `config.json` from the repository history. This script is intentionally
# conservative: by default it performs checks and prints the commands you should
# run. To actually perform the rewrite you must pass --run and also set the
# environment variable RUN_GIT_FILTER_REPO=1 to opt into the destructive action.
#
# WARNING: Rewriting git history is destructive for shared branches. Coordinate
# with your team and understand that rewritten branches require force-pushing
# and everyone must re-clone or rebase.

usage() {
  cat <<'EOF'
Usage: remove-config-history.sh [--preview|--run]

  --preview   : Show commits that reference config.json and print the safe
                commands to run when you are ready.
  --run       : Perform the rewrite using git-filter-repo (requires
                RUN_GIT_FILTER_REPO=1 in environment and git-filter-repo installed).

Examples:
  # Preview commits and recommended steps
  ./scripts/cleanup/remove-config-history.sh --preview

  # Actually perform the rewrite (destructive) - explicit opt-in required
  RUN_GIT_FILTER_REPO=1 ./scripts/cleanup/remove-config-history.sh --run

EOF
  exit 1
}

if [[ ${1:-} != "--preview" && ${1:-} != "--run" ]]; then
  usage
fi

MODE="$1"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this script must be run from inside a git repository root." >&2
  exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working directory is not clean. Commit or stash changes before proceeding." >&2
  exit 3
fi

echo "Checking repository history for 'config.json' references..."
COMMITS=$(git log --all --pretty=format:%H -- config.json 2>/dev/null || true)

if [[ -z "$COMMITS" ]]; then
  echo "No commits reference config.json. Nothing to rewrite.";
  exit 0
fi

echo "Found commits that reference config.json (showing brief log):"
git log --all --pretty=format:'%h %ad %an %s' --date=short -- config.json

if [[ "$MODE" == "--preview" ]]; then
  cat <<'EOF'

Recommended safe preview steps:

1) Create a mirror clone (this does not touch your current repo):
   TMPDIR=$(mktemp -d)
   git clone --mirror "$(pwd)" "$TMPDIR/repo.git"

2) If you have git-filter-repo installed, run inside the mirror:
   cd $TMPDIR/repo.git
   git filter-repo --invert-paths --path config.json

3) Inspect the mirror (refs, commits, tags) and verify the file was removed.

4) When you're ready to replace the remote, coordinate with the team and then
   push the cleaned mirror with: git push --mirror <remote-url>

If git-filter-repo is not available, consider using the BFG Repo-Cleaner:
  https://rtyley.github.io/bfg-repo-cleaner/

EOF
  exit 0
fi

# --run path below -- requires explicit opt-in via RUN_GIT_FILTER_REPO=1
if [[ "${RUN_GIT_FILTER_REPO:-}" != "1" ]]; then
  echo "Destructive run requested but RUN_GIT_FILTER_REPO is not set to 1." >&2
  echo "To perform the rewrite set RUN_GIT_FILTER_REPO=1 and re-run with --run." >&2
  exit 4
fi

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo not found. Install it (https://github.com/newren/git-filter-repo) or use BFG." >&2
  exit 5
fi

echo "Preparing mirror clone and performing history rewrite (this may take time)..."
TMPDIR=$(mktemp -d)
MIRROR="$TMPDIR/repo.git"

git clone --mirror "$(pwd)" "$MIRROR"
pushd "$MIRROR" >/dev/null

echo "Running: git filter-repo --invert-paths --path config.json"
git filter-repo --invert-paths --path config.json

echo "Rewrite complete. Cleaned mirror is at: $MIRROR"
echo "Inspect it now. To replace a remote you will need to push the mirror:`git push --mirror <remote>`"
echo "DO NOT push until you have coordinated with your team and understand the consequences."

popd >/dev/null

exit 0
