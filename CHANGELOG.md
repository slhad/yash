# Changelog

## Unreleased

- Remove OS keyring integration (keytar) and hybrid encryption export/import.
  - Tokens are now stored in plaintext JSON under the data directory (default: `~/.yash/tokens.json`).
  - Admin export/import/rotation endpoints related to encryption now return 501 Not Implemented.
  - Pre-commit hook installer and `.githooks` installer removed; fallback scanner left as a local helper.

Security notes:
- Tokens and admin key backups stored on disk are plaintext or HMAC-hashed metadata. Operators must ensure strict filesystem permissions and consider using an external secrets manager (Vault) if encryption at rest is required.

If you need the previous encrypted behavior restored, reintroduce a configurable secrets backend (Vault) or make encryption optional and well-documented.
