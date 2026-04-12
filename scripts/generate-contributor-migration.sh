#!/usr/bin/env bash
# Generate contributor migration instructions (non-destructive)
# Usage: sh scripts/generate-contributor-migration.sh --out tmp/migration-instructions.sh

set -euo pipefail

OUT_FILE="tmp/migration-instructions.sh"
mkdir -p tmp

cat >"$OUT_FILE" <<'EOF'
#!/usr/bin/env bash
# Migration instructions (automated helper) - DO NOT run before reading
echo "Migration helper"
echo "Option 1: Recommended (re-clone) - simplest and safest"
echo "  1) Backup your current repo: git bundle create ~/myrepo.bundle --all"
echo "  2) Clone fresh: git clone <repo-url> myrepo-clean"
echo "  3) Re-apply any local changes from your bundle or patches"

echo "Option 2: Advanced (power users) - rebase/cherry-pick local branches"
echo "  1) Create a backup of your refs: git for-each-ref --format='%(refname:short) %(objectname)' refs/heads | while read r h; do git bundle create ~/myrepo-$r.bundle $h; done"
echo "  2) Add the rewritten remote as temporary remote: git remote add rewritten <rewritten-repo-url>"
echo "  3) For each branch: git fetch rewritten branch && git rebase rewritten/branch || git cherry-pick <commits>"
echo "  4) Verify and push to your fork: git push origin --all"

echo "If you need help, contact the maintainers in the parent repository."
EOF

chmod +x "$OUT_FILE"
echo "Migration instructions written to $OUT_FILE"
