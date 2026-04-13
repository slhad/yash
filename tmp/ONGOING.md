Next steps (ongoing) - do not commit

1) Finish hardest followup (different from last two):
   - Implement unit tests for admin authentication and admin endpoints, including IP allowlist and rate-limiting behaviors. Cover AdminService create/list/revoke and audit integration.
   - Add an end-to-end test that exercises admin endpoints using generated admin tokens.
   - Document the Admin API in README (added).

2) Safety & consistency:
    - Ensure all admin endpoints use authorizeAdmin (done).
    - Review and tighten audit entries to avoid accidental secret capture (avoid token plaintexts).
    - Support admin keys stored in AdminService: authorizeAdmin should recognize admin keys and surface adminKeyId and method in its result (done).
    - Include adminKeyId and method in audit metadata for all admin operations (done).

3) Tests & CI:
    - Add tests for exportEncryptionKey and exportEncryptedTokens (added).
    - Add tests for Audit.verifyAll and tailLines.
    - Add a CI job that runs Bun tests and the secret-scan action (added: .github/workflows/ci.yml).
    - Consider adding gitleaks or similar as a required check in CI for PRs.

4) Ops / cleanup:
    - Coordinate secret rotation for config.json present in working tree.
    - Optionally run scripts/cleanup/remove-config-history.sh with team agreement.
    - A non-destructive preview helper was added: scripts/cleanup/preview-remove-config.sh
      which creates a mirror clone and runs the filter in the mirror if git-filter-repo is
      available. Use it to validate what history will look like before performing the
      destructive rewrite.

5) Followups (future):
   - Consider integrating mutual TLS or other network-level protections for admin endpoints.
   - Add RBAC for admin actions beyond single ADMIN_TOKEN and admin keys. (Basic roles support added to AdminService: `roles` on keys, and listKeys now returns roles.)

Notes:
- tmp directory is git-ignored by .gitignore and should not be committed.
