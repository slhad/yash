Post-test run update and next steps (committed record)
====================================================

Run summary
-----------
- Date: 2026-04-12
- Command: `bun test`
- Result: All tests passed locally
  - 91 tests passed across 15 files
  - 0 tests failed

Key observations
----------------
- Tests exercise OBS websocket integration using mock servers on ports 4455 and 9001.
- config.json contains an OBS websocket password in plaintext. This is sensitive and should be moved out of version control.

Next steps (recommended)
------------------------
1. Replace config.json with config.example.json (no secrets) and move secrets into environment variables or a gitignored local config.
2. Add CI that runs `bun test` and `biome check --write`.
3. Triage TODOs in src/ and tests/ and create issues for larger technical-debt items.
4. Add CONTRIBUTING.md explaining how to run tests and stub services locally.

Committed by automation on branch: master
