Purge Approval Bot & Actions Gating (tracked)

Purpose:
- Document the GitHub Actions-based gating and manual execution flow for the purge. This ensures the validate and execute steps are auditable and tied to PR approvals.

Validate job:
- Runs on canary PRs. Executes tests, gitleaks, evidence generation script, and posts a summary comment with artifacts attached.

Execute job (manual dispatch):
- Requires: CONFIRM_PURGE=1 and at least two unique approvers on the canary PR.
- Uses repository secret PURGE_EXECUTOR_TOKEN to run the orchestrator and perform force-push.
- Uploads all artifacts to workflow artifacts for audit.

Security considerations:
- Limit PURGE_EXECUTOR_TOKEN scope and rotate immediately after use.
- Keep repository secret access tightly controlled (admins only).
