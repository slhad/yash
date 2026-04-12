Keyring Verification Helper Added

Summary
-------
Added scripts/verify-keyring.mjs which lists account names under service `yash.tokens` using keytar
and writes a safe file tmp/keyring-accounts.txt (contains account names only, no secret values).

How to run
----------
1. Ensure keytar is installed: `bun add -d keytar` (already added in repo).
2. Run: `bun run scripts/verify-keyring.mjs`.

Notes
-----
- This helper is non-destructive and only prints account names. It does not reveal secret values.
- Useful for verifying migration success after running scripts/migrate-tokens-to-keyring.js.
