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
    - Added a GitHub Action to run a secret-scan: .github/workflows/secret-scan.yml (gitleaks).
    - Added local pre-commit hook and installer: .githooks/pre-commit and scripts/precommit/install-hooks.sh
      plus a Node fallback scanner scripts/precommit/fallback.js for environments without gitleaks.

4) Ops / cleanup:
    - Coordinate secret rotation for config.json present in working tree.
    - Optionally run scripts/cleanup/remove-config-history.sh with team agreement.
    - A non-destructive preview helper was added: scripts/cleanup/preview-remove-config.sh
      which creates a mirror clone and runs the filter in the mirror if git-filter-repo is
      available. Use it to validate what history will look like before performing the
      destructive rewrite.
    - AdminService now supports best-effort Vault-backed storage for admin keys (VAULT_ADDR, VAULT_TOKEN,
      VAULT_KV_MOUNT, VAULT_SECRET_PATH). If Vault is configured, admin keys will be read from and written to Vault
      (KV v2) in addition to the local admin_keys.json file.
    - Added migration helper: scripts/admin/migrate-admin-keys-to-vault.sh
      Use --preview to inspect the payload and --run with RUN_MIGRATE=1 and
      proper VAULT_* environment variables to perform the migration.
    - Added HMAC rotation support to AdminService and a test to validate lazy migration of token hashes.

5) Followups (future):
   - Consider integrating mutual TLS or other network-level protections for admin endpoints.
   - Add RBAC for admin actions beyond single ADMIN_TOKEN and admin keys. (Basic roles support added to AdminService: `roles` on keys, and listKeys now returns roles.)
   - Endpoints added:
     - POST /api/admin/keys/update-roles { id, roles } (requires admin role)
     - RBAC enforcement added to create/revoke operations (requires admin role unless ADMIN_TOKEN used)

Notes:
- tmp directory is git-ignored by .gitignore and should not be committed.
