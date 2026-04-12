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

Detailed Simulation Runbook (non-destructive)

Prerequisites:
- Ensure git-filter-repo is installed and in PATH. Confirm with: git filter-repo --version
- Ensure your working tree is clean and you have sufficient disk space (simulation will duplicate repo history).

Steps:
1) Create a mirror and simulation clone
   - git clone --mirror "$PWD" tmp/repo-mirror.git
   - git clone tmp/repo-mirror.git tmp/repo-sim
2) Prepare replacements file
   - Ensure tmp/replacements-curated.txt has been manually pruned and vetted.
   - Copy vetted replacements into the sim: cp tmp/replacements-curated.txt tmp/repo-sim/replacements.txt
3) Run filter-repo in the simulation
   - cd tmp/repo-sim
   - git filter-repo --replace-text replacements.txt
4) Validate simulation
   - Run: bun test (or your test runner) inside tmp/repo-sim to ensure code still builds/tests pass.
   - Run gitleaks against tmp/repo-sim and compare results with original repository.
   - Inspect branches/tags: git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags
   - Count commits: git rev-list --all --count
   - Compare with original mirror (tmp/repo-mirror.git) to see how many commits/objects were altered/removed.
5) Produce report
   - Save the above findings to tmp/purge-simulation-report.txt. Include details on:
     * Commands run
     * Commit counts before vs after
     * CI/test pass/fail status
     * gitleaks output
     * Any manual issues found (broken imports, test failures)

If simulation succeeds and maintainers approve, follow the execution steps in this document.
