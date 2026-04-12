Contributing to YASH
===================

Thanks for helping improve YASH. This file contains the minimal, low-friction steps to get a developer environment running and follow contributor hygiene for secrets and local configuration.

Local setup (quick)
-------------------
1. Install Bun (https://bun.sh) if you don't have it.
2. Install dependencies:

   ```sh
   bun install
   ```

3. Create your local config from the template (do NOT commit config.json):

   ```sh
   cp config.example.json config.json
   # Edit config.json locally to add your OBS password and stream keys
   ```

4. Install local repository hooks (optional but recommended):

   ```sh
   sh scripts/install-hooks.sh
   ```

   The pre-commit hook will warn or block commits that include `config.json` or likely plaintext secret patterns.

Key management notes
--------------------
- The app will use an encryption key to persist tokens. It prefers the following (in order):
  1. `YASH_ENCRYPTION_KEY` environment variable (normalized to a 32-byte hex string)
 2. OS keyring via `keytar` (optional runtime dependency) — keys are stored under service `yash`, account `encryption-key`
 3. File-based key at `~/.yash/key` (created with restricted file permissions)

If you want keytar integrated for local development, add it as a dev dependency:

```sh
bun add -d keytar
```

Secrets and config
------------------
- Never commit secrets or `config.json`. Use `config.example.json` as the template.
- If a secret was committed in the past, follow the project's purge guidance and rotate credentials immediately.

Coding conventions and CI
------------------------
- Formatting and linting are enforced with Biome. CI runs `biome check --write` and `bun test`.
- There is a GitHub Action that runs gitleaks to detect secrets in history and PRs.

Workflow tips
-------------
- Make small, focused PRs and run the pre-commit hooks locally before pushing.
- If you need to run a development TUI session:

  ```sh
  bun --hot ./src/main.tsx
  ```

Reporting issues
----------------
- Open a GitHub issue with a concise title, steps to reproduce, and any logs or error messages. For security-sensitive leaks, contact repo owners directly and do not post secrets in issues.

Thank you for contributing!
