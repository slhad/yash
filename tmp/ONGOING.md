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

Notes
- tmp/ is gitignored; file created to satisfy the workflow requirement. Will be force-added to commit per instruction.
