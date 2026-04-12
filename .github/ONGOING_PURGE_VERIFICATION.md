Purge Verification — Forensic Simulation & Recovery Plan (tracked)

Purpose:
- This tracked file records the forensic verification and dry-run validation plan to produce objective metrics and a testable recovery plan before any destructive purge.

Steps (summary):
1. Baseline capture: create a mirror and record commit counts, object counts, and pack verification.
2. Controlled simulation: clone mirror, apply vetted replacements via git-filter-repo (simulation only).
3. Post-sim metrics: capture commit counts, object counts, pack verification for comparison.
4. Integrity checks: run tests, run gitleaks, run linter/typecheck in the simulation repo.
5. Recovery validation: backup the mirror and validate restore.
6. Report & sign-off: consolidate findings into tmp/purge-simulation-report.txt and obtain two maintainer approvals.

Audit:
- Update this file with links to tmp/purge-simulation-report.txt and tmp/repo-mirror-backup.sha256 after simulation. Keep sign-offs recorded here for traceability.

Execution note:
- This procedure is non-destructive when performed against the tmp/repo-sim clone. Do not run the final purge until sign-offs are collected.
