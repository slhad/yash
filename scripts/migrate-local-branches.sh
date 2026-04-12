#!/usr/bin/env bash
# Migrate local branches using tmp/commit-map.txt (dry-run by default)
# Usage: sh scripts/migrate-local-branches.sh [--apply]

set -euo pipefail

APPLY=0
if [ "${1:-}" == "--apply" ]; then APPLY=1; fi

if [ ! -f tmp/commit-map.txt ]; then
	echo "tmp/commit-map.txt not found. Run scripts/generate-commit-map.mjs first." >&2
	exit 2
fi

echo "Reading commit map..."
declare -A MAP
while read -r OLD NEW SCORE METHOD; do
	if [ "$NEW" != "-" ]; then
		MAP["$OLD"]="$NEW"
	fi
done <tmp/commit-map.txt

for br in $(git for-each-ref --format='%(refname:short)' refs/heads); do
	echo "Processing branch: $br"
	# find earliest commit in branch that is in map
	base_old=$(git rev-list --reverse "$br" | while read c; do if [ -n "${MAP[$c]:-}" ]; then
		echo "$c"
		break
	fi; done)
	if [ -z "$base_old" ]; then
		echo "  No mapped base found for $br; skipping"
		continue
	fi
	base_new=${MAP[$base_old]}
	echo "  Mapped base: $base_old -> $base_new"
	migrated_branch="migrated/$br"
	echo "  Will create $migrated_branch pointing at $base_new and cherry-pick remaining commits (dry-run)"
	if [ "$APPLY" -eq 1 ]; then
		git branch -f "$migrated_branch" "$base_new"
		# cherry-pick commits after base_old
		for c in $(git rev-list --reverse "$br" ^$base_old); do
			git checkout "$migrated_branch"
			git cherry-pick --allow-empty "$c" || {
				echo "Cherry-pick failed for $c; aborting"
				exit 3
			}
		done
		echo "  Created $migrated_branch"
	fi
done

echo "Done. If --apply wasn't used, run with --apply to perform changes (ensure you have backups)"
