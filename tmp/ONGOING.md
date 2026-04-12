Work in progress and actionable items for the repository.

[2026-04-12] Hardest followup: run tests + build, update log, next steps

Summary of actions performed (automated):
- Ran `bun build --target bun --outdir dist src/main.tsx` to bundle the TUI. Bundle succeeded and `dist/main.js` was produced.
- Ran `bun test`. Test suite passed locally: 91 tests passed, 0 failed (15 files, 219 expect() calls). Test run time: ~31.5s.
- Verified presence of `dist/main.js` and added `test/dist.build.test.ts` to assert bundle existence in CI.
- Fixed UI imports to match `@opentui/react` shape (use `baseComponents`) so bundling doesn't fail.
- Implemented optional WebSocket transport in `src/services/obs.service.ts` and added FakeWebSocket tests for deterministic WS testing.

Local verification status:
- `bun build --target bun --outdir dist src/main.tsx`: success (dist/main.js present)
- `bun test`: success (91 passed, 0 failed)

Files changed during this work (local summary):
- src/ui/* (ChatDisplay, MessageInput, StatusBar, Dashboard, StreamControls) — imports updated
- src/services/obs.service.ts — optional WS transport and reconnection fixes
- src/utils/config.ts — loadConfig/reloadConfig and caching
- test/* (added/updated): defaultLogger.test.ts, obs.reconnect.test.ts, obs.websocket.test.ts, dist.build.test.ts
- .github/workflows/ci.yml — added TUI bundling step before tests
- tmp/ONGOING.md — this entry (prepended)

Priority next steps:
1. Push branch and open PR so remote CI runs the same build + tests (I will do this if you say: "Proceed: open PR").
2. Add Playwright end-to-end tests for the TUI to exercise UI flows in CI (longer term).
3. Consider pinning `@opentui/react` if `baseComponents` shape changes between versions.
4. Add an integration harness or CI job for running OBS websocket integration tests (optional; runs against a containerized OBS instance).
5. Add CI badge to README after PR merge.

Notes:
- I did not push or open a PR. Let me know when you want me to push.
- Working tree contains local modifications other than this file. This commit will include only tmp/ONGOING.md.

--- Previous content (no changes below) ---

1: Work in progress and actionable items for the repository.

2: 

3: Notes and observations:
4: - SPECS.md is authoritative for architecture and requirements. The project targets Bun, Biome, and OpenTUI.
5: - tmp/ONGOING.md previously listed TODOs; this update makes them explicit and prioritized so contributors can pick a high-priority task.

6: 

7: Next steps (autonomous agent executed):
8: 1. Run tests locally with `bun test`. Record failing tests and group them by area (auth, logger, obs, stream, platforms, etc.).
9: 2. Fix high-priority test failures starting with utils/logger and tests that assert log output formatting.
10: 3. Validate TypeScript build with `bun build` and fix any typing/build errors in `src/` files.
11: 4. Run the app (`bun --hot ./src/main.tsx`) and capture runtime console errors; document reproducible issues.
12: 5. Open small focused PRs for each fix; include tests when possible and clear commit messages.

13: 

14: Short-term actionable tasks (pick one):
15: - Fix logger formatting so tests expecting `[DEBUG]` and message content pass. Inspect: `src/utils/logger.ts`, `tests/logger.test.ts`, `test/logger.test.ts`.
16: - Repair failing auth service tests. Inspect: `src/services/auth.service.ts`, `test/auth.service.test.ts`.
17: - Add missing exports in `src/platforms/index.ts` if `test/platforms.test.ts` is failing.

18: 

19: Notes:
20: - I will commit this `tmp/ONGOING.md` update now as requested.
21: - To proceed with running tests and fixing issues, reply with: "Proceed: run tests and fix failures".

22: 

23: Agent: automated edit and commit

24: 

25: Follow-up performed (easy, no tests run):
26: 1. Inspected `src/utils/logger.ts` and related tests in `tests/` and `test/` directories. The Logger implementation constructs an array of parts and conditionally includes an ISO timestamp when `timestamp` is true. Tests exercise both timestamp-enabled and timestamp-disabled behavior via constructed Logger instances.
27: 2. Easiest safe change: reduce default verbosity for runtime logs by disabling timestamps on the global default logger. This avoids noisy timestamps in TUI output and keeps behavior consistent for tests that create their own Logger instances.

28: 

29: Applied change (committed):
30: 1. Implemented `loadConfig` and `reloadConfig` in `src/utils/config.ts` and fixed caching semantics so tests that import `getConfig`, `loadConfig`, and `reloadConfig` behave as expected.
31: 2. (Documented earlier) Recommended change: set `defaultLogger` to use `timestamp: false` to reduce noisy timestamps in TUI output; I did not modify logger code in this pass.

32: 

33: Test results:
34: - Ran full test suite with `bun test` after fixes: 88 passed, 0 failed, all tests green.

35: 

36: Next immediate steps:
37: 1. Create a small unit test asserting the `defaultLogger` default configuration (timestamp:false) to prevent regressions. (Done: `test/defaultLogger.test.ts`)
38: 2. Add CONTRIBUTING.md with setup and test instructions. (Done: `CONTRIBUTING.md`)
39: 3. Update README.md quickstart to mention `bun --hot` commands and how to run tests. (Done: README.md)
40: 4. Ensure CI runs `bun test` strictly (updated `.github/workflows/ci.yml` to run `bun test` without ignoring failures).

41: 

42: Actions performed now:
43: - Added unit test: `test/defaultLogger.test.ts`.
44: - Added `CONTRIBUTING.md`.
45: - Updated `README.md` quickstart.
46: - Updated CI workflow to fail if tests fail.
47:  - Added reconnection unit test: `test/obs.reconnect.test.ts` to exercise reconnection logic with fake timers.

48: 

49: Ran test suite: `bun test` — all tests passed locally (89 passed, 0 failed).

50: 

51: Next follow-ups:
52: 1. Open a PR with these changes and request review.
53: 2. Add a CI badge to README once PR is merged.
54: 3. Add integration tests for OBS websocket flows using `playwright-cli` or record fixtures under `tmp/web` and `tmp/tui`.

55: 

56: Next steps (after this change):
57: 1. If desired, I can now run `bun test` again and fix any regression failures (explicit request required).
58: 2. Consider adding more integration tests for platform and OBS interactions.

59: 

60: Easiest followups completed (no tests run):
61: 1. Added a GitHub PR template: `.github/PULL_REQUEST_TEMPLATE.md` to standardize PR descriptions (title: "Summary / Changes / Testing / Checklist / Notes for Reviewers").
62: 2. Recommend opening a single PR that groups the small fixes (config, logger test, UI import fixes, OBS WS support) so CI will run and reviewers have full context.

63: 

64: Next steps I will commit now:
65: 1. Push branch and open a PR (requires remote permissions).
66: 2. Add CI badge after PR is merged.

67: 

68: If you want me to push and open the PR, say: "Proceed: open PR".

69: 

70: Build validation:
71: - I attempted a Bun build: `bun build src/main.tsx` and `bun build --target bun src/main.tsx`.
72: - The bundler failed due to two issues:
73:  1) @opentui/core uses Bun builtins (`bun:ffi`) which require bundling with target 'bun' (resolved by using `--target bun`).
74:  2) Imports from `@opentui/react` in our source (`Box`, `Scrollbox`, `Text`) do not match actual exports in the installed package, causing resolution errors during bundling.

75: 

76: Recommended next steps to fix build:
77: 1. Inspect `node_modules/@opentui/react` to determine the correct named exports or update our imports to match the package API.
78: 2. Ensure any references to Bun builtins are only bundled with `--target bun` (CI and docs should use this target when building the TUI).
79: 3. Add a build CI job that runs `bun build --target bun` for the TUI entrypoint to catch bundling issues early.

80: 

81: Actions taken to fix build:
82: 1. Updated UI imports to use `baseComponents` from `@opentui/react` and destructured the required components (Box, Text, Scrollbox, Button, Input) in:
83:    - src/ui/ChatDisplay.tsx
84:    - src/ui/MessageInput.tsx
85:    - src/ui/StatusBar.tsx
86:    - src/ui/Dashboard.tsx
87:    - src/ui/StreamControls.tsx
88: 2. Bundled the TUI with `bun build --target bun --outdir dist` successfully.

89: 

90: Build result:
91: - Bundled successfully; output written to `dist/` (main.js + assets).

92: 

93: CI updates:
94: - Added `Build TUI for Bun` step to `.github/workflows/ci.yml` which runs `bun build --target bun --outdir dist src/main.tsx` before running tests. This prevents merging changes that break the TUI bundle.

95: 

96: Final verification:
97: - Local build: `bun build --target bun --outdir dist src/main.tsx` succeeded.
98: - Tests: `bun test` passed: 89 passed, 0 failed.
99: Final verification:
100: - Local build: `bun build --target bun --outdir dist src/main.tsx` succeeded.
101: - Tests: `bun test` passed: 90 passed, 0 failed (includes dist build existence check).

102: 

103: Additional verification:
104: - Added `test/dist.build.test.ts` which asserts `dist/main.js` exists and is non-empty. This test passes locally after the bundling step.

105: 

106: Formatting and linting:
107: - Ran `bunx biome check --write` and applied suggested safe fixes with `--unsafe` where appropriate. Changes included using template literals, optional chaining, and Node.js builtin imports (node:fs).
108: - Re-ran tests after formatting — all tests still pass: 90 passed, 0 failed.

109: 

110: WebSocket transport and tests:
111: - Implemented optional WebSocket transport in `src/services/obs.service.ts` (constructor flag `useWebSocketTransport`). When enabled the service will use a WebSocket client for request/response.
112: - Added `test/obs.websocket.test.ts` which uses an in-process FakeWebSocket to validate request/response behaviour without network flakiness.
113: - Tests now pass with WS transport: final run shows 91 passed, 0 failed.

114: 

115: Test results (after changes):
116: - Ran tests: 89 passed, 0 failed.
