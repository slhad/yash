Keytar Added (devDependency)

Summary
-------
Added keytar as a development dependency to enable OS keyring-based token migration and
storage on developer machines.

What changed
------------
- package.json devDependencies now includes `keytar`.

Next steps (manual)
------------------
1. Run `bun run scripts/migrate-tokens-to-keyring.js` on a dev machine to migrate tokens.json into the keyring.
2. Verify migration and remove backup files once validated.
3. Optionally add scripts/verify-keyring.js to programmatically confirm keyring entries.

This change does not run tests or perform migrations automatically; it only prepares the repository
so maintainers can run migration safely.
