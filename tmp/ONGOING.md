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

Notes
- tmp/ is gitignored; file created to satisfy the workflow requirement. Will be force-added to commit per instruction.
