Purge Canary Orchestration (tracked)

This file documents the canary orchestration plan and records the execution steps and signoffs.

Key points:
- The orchestrator script scripts/purge-canary-orchestrator.sh performs simulation steps by default; destructive force-push requires --execute, CONFIRM_PURGE=1, and a PROVIDE_SIGNOFF_FILE with maintainer approvals.
- The canary branch approach allows reviewers to inspect the rewritten history before any destructive operation.
- Maintain an audit trail: tmp/purge-simulation-report.txt, tmp/sim_gitleaks.json, tmp/sim_test_output.txt, tmp/repo-mirror-backup.sha256, tmp/signoffs.txt.

Execution log:
- Update this file with timestamps and PR links when canary branch is pushed and CI has run.
