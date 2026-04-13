Work in progress log - tmp/ONGOING.md

2026-04-13
- Implemented exponential backoff with full jitter for ObsService reconnects.
- Made tests deterministic by stubbing Math.random in reconnection tests.
- Exposed reconnect tuning parameters via ObsService constructor (reconnectMaxMs, reconnectMultiplier).

Next steps
- Add unit tests that assert backoff growth deterministically (use fake timers and controlled Math.random).
- Consider adding a maxAttempts option to stop reconnection after N tries and emit an event.
- Expose backoff config via runtime config (getConfig) or env variables for production tuning.

Done this turn
- Added deterministic unit test: test/obs.backoff.unit.test.ts

Next (candidate) tasks
- Add maxAttempts and event when exceeded (harder follow-up).
- Wire backoff parameters to getConfig() so they can be set from config file (medium).
- Add integration test with fake WS server to validate reconnection in a more realistic environment (hard).

Done this turn
- Added WebSocket reconnection integration test: test/obs.websocket.reconnect.test.ts

Next (candidate) tasks
- Implement maxAttempts with an event when exceeded (hard).
- Wire backoff parameters to getConfig() so they can be set from config file (medium).
- Add CI job to run Playwright + reconnection integration tests in a hermetic environment (very hard).

Done this turn
- Implemented reconnect maxAttempts option and event subscription support. Added test: test/obs.maxAttempts.unit.test.ts

Next (candidate) tasks
- Expose backoff parameters via getConfig() and environment variables (medium).
- Add logging metrics for reconnection attempts and failures (medium).
- Harden integration test to run under CI runners without fake timers (hard).

Done this turn
- Added a hermetic CI job to run Playwright e2e and reconnection integration tests: .github/workflows/ci.yml -> integration-hermetic

Next (candidate) tasks
- Wire backoff parameters to getConfig() and environment variables (medium).
- Add metrics/logging for reconnection attempts (medium).
- Replace fake-timer integration tests with real-network based end-to-end runs under a controlled CI container (very hard).

Done this turn
- Converted WS reconnection integration test to use real timeouts instead of fake timers so it is compatible with CI runners.

Next (candidate) tasks
- Wire backoff parameters to getConfig() and environment variables (medium).
- Add metrics/logging for reconnection attempts (medium).
- Improve CI readiness checks (poll /api/status instead of sleep) for hermetic integration job (medium).

Done this turn
- Added lightweight in-memory metrics collector at src/utils/metrics.ts and wired a counter for obs.reconnect.failures in ObsService.
- Exposed metrics via /api/obs/status to aid CI/diagnosis.

Next (candidate) tasks
- Wire backoff parameters to getConfig() and environment variables (medium).
- Add more metrics (successes, attempts, lastAttemptTs) and expose them via a /api/metrics endpoint (medium).
- Replace sleep with polling /api/status readiness check in CI job (medium).

Done this turn
- Replaced CI `sleep` with a polling readiness check against /api/status for both e2e and integration-hermetic jobs.

Next (candidate) tasks
- Wire backoff parameters to getConfig() and environment variables (medium).
- Add more metrics (successes, attempts, lastAttemptTs) and expose them via a /api/metrics endpoint (medium).
- Add CI-level retries around flaky integration steps (medium).

Done this turn
- Wired backoff and timing parameters to runtime config/env via src/utils/config and ObsService.loadConfigSync.
- Supported env vars: YASH_OBS_RECONNECT_BASE_MS, YASH_OBS_RECONNECT_MAX_MS, YASH_OBS_RECONNECT_MULTIPLIER, YASH_OBS_RECONNECT_MAX_ATTEMPTS, YASH_OBS_CONNECT_DELAY_MS

Next (candidate) tasks
- Add more metrics (successes, attempts, lastAttemptTs) and expose them via a /api/metrics endpoint (medium).
- Add CI-level retries around flaky integration steps (medium).
- Consider adding documentation in README for configuring OBS reconnection behavior via env/config (low).

Notes
- tmp/ is gitignored; file created to satisfy the workflow requirement. Will be force-added to commit per instruction.
