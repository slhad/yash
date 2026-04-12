Keyring Integration & Migration (plan)

Objective
---------
Enable OS keyring support (keytar) for token storage, migrate existing file-based tokens
to the OS keyring, wire background token auto-refresh at initialization, and add tests
to validate the behavior.

Steps performed so far
----------------------
- AuthService already contains optional keytar dynamic import and fallback to file-based keys.
- A migration helper script exists at scripts/migrate-tokens-to-keyring.js which will move
  entries from tokens.json into the keyring service `yash.tokens` and back up the original file.

Planned Actions (local/non-destructive)
--------------------------------------
1. Add keytar to devDependencies: `bun add -d keytar`.
2. Run `bun install` and run tests locally in an environment with keytar available to verify behavior.
3. Run `bun scripts/migrate-tokens-to-keyring.js` to migrate tokens (creates a timestamped backup of tokens.json).
4. Verify entries in the keyring and remove the backup after verification.
5. Wire `authService.startAutoRefresh({ youtube, twitch, kick }, 60000)` in src/index.ts after provider registration.
6. Add unit tests mocking keytar to simulate keyring operations in CI.

CI Notes
--------
- Prefer mocking keytar in CI. If real keytar is required, ensure CI runner has native dependencies available.

No destructive actions will be taken by this plan. This is a non-destructive followup to improve security posture.
