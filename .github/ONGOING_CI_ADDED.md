CI workflow added and next steps
==============================

Summary
-------
- Added GitHub Actions CI workflow at .github/workflows/ci.yml
  - Job `test`: sets up Bun, installs dependencies, runs `bun test` (which includes `biome check --write` per package.json scripts)
  - Job `secret-scan`: non-blocking scan for common plaintext secret patterns in tracked files; skips node_modules and dist

Why this is the "hardest" followup
---------------------------------
- Introducing CI affects developer workflow, surfaces build/test regressions early, and requires ensuring the repository's tests and environment are reproducible in CI. It also creates a natural place to detect accidental secrets in commits.

Next steps
----------
1. Replace config.json with config.example.json and remove secrets from source history if necessary.
2. Add documentation in README.md or CONTRIBUTING.md for running the test suite locally (including mock OBS websocket usage).
3. Monitor the first CI runs and fix any environment-specific test failures that appear on Ubuntu runners.

Committed record: .github/workflows/ci.yml added
