#!/usr/bin/env bash
# Prepare a purge approval issue or PR template and open it using gh (if available).

set -euo pipefail

TITLE="Purge Simulation: Review & Approval"
BODY_FILE="tmp/purge_approval_body.md"

mkdir -p tmp

cat >"$BODY_FILE" <<'EOF'
## Purge Simulation - Review & Approval

This issue/PR contains the simulation results for the planned secret purge. Reviewers: please verify the tmp/purge-simulation-report.txt and tmp/evidence/ artifacts.

Checklist:
- [ ] Confirm replacements file vetted (tmp/replacements-curated.txt)
- [ ] CI passing on canary PR
- [ ] Evidence artifacts present in tmp/evidence/
- [ ] At least two maintainers have approved

Signoff format (add a comment with the following line):
`SIGNOFF: <github-username> <YYYY-MM-DD>`
EOF

if command -v gh >/dev/null 2>&1; then
	gh issue create --title "$TITLE" --body-file "$BODY_FILE" || true
else
	echo "gh not found; created $BODY_FILE. Please open an issue or PR manually with this content."
fi
