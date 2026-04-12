Purge Simulation — Next Steps (tracked)

Purpose:
- This file mirrors tmp/ONGOING.md for audit and reviewer visibility. It documents non-destructive simulation steps and required sign-offs before any destructive history rewrite.

Immediate actions (maintainers):
1. Manual curation
- Review tmp/replacements-curated.txt and remove non-secret / generic strings. Keep only real secrets (stream keys, OBS password, OAuth client secrets). Remember: git-filter-repo --replace-text does literal replacements; replacing common tokens will break code.

2. Rotate credentials
- Rotate any real credentials noted for purge. Store rotation evidence (no secrets) in tmp/evidence/ and summarize in tmp/rotation-evidence.txt.

3. Readiness checklist
- Run: sh scripts/prepare-purge-checklist.sh and address any failures.

4. Simulation
- Create mirror & sim clone, apply replace-text in sim, and run test suite and gitleaks against sim. Save report to tmp/purge-simulation-report.txt.

5. Sign-off and execute
- Gather two maintainer approvals on the simulation report and rotation evidence. Only then run the purge script with CONFIRM_PURGE=1 and --execute.

Audit trail:
- Keep this file updated with sign-offs and links to tmp/purge-simulation-report.txt and tmp/rotation-evidence.txt.
