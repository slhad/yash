# Yet Another Streamer Helper (YASH)

Small toolkit to manage streaming across YouTube, Twitch, and Kick with a
unified interface. Written to run on Bun. This repository contains:

- src/: TypeScript source (platform providers, services, UI)
- test/: Unit and integration tests (run with `bun test`)
- config.json: (local config) Not committed — use config.example.json as a template and create a local config.json with your secrets.

Quickstart

1. Install dependencies: `bun install`
2. Run tests: `bun test`
3. Launch the TUI (development with hot reload): `bun --hot ./src/main.tsx`

Configuration
-------------
This project reads configuration from `config.json` in the repository root during local runs and tests. Do NOT commit secrets.

1. Copy `config.example.json` to `config.json` and update values that are local-only (obs websocket password, stream keys, etc.).
   - `cp config.example.json config.json`
2. Add `config.json` to `.gitignore` if it's not already ignored (this repository's .gitignore already includes `config.json`).

OBS Reconnection & Backoff
--------------------------
You can tune the OBS websocket reconnection and backoff behaviour via environment variables or `config.json` (under `obs.websocket`). Environment variables take precedence and are useful for CI/runtime overrides.

Environment variables (examples & defaults):

- `YASH_OBS_SERVER` — OBS websocket host (eg. `localhost`)
- `YASH_OBS_PORT` — OBS websocket port (eg. `4455`)
- `YASH_OBS_PASSWORD` — OBS websocket password
- `YASH_OBS_RECONNECT_BASE_MS` — base backoff delay in ms (default: `30000`)
- `YASH_OBS_RECONNECT_MAX_MS` — maximum backoff cap in ms (default: `300000` / 5min)
- `YASH_OBS_RECONNECT_MULTIPLIER` — exponential multiplier (default: `2`)
- `YASH_OBS_RECONNECT_MAX_ATTEMPTS` — maximum retry attempts (default: unlimited)
- `YASH_OBS_CONNECT_DELAY_MS` — simulated connect delay in ms (used for testing, default: `1000`)

Example (env):

```
export YASH_OBS_RECONNECT_BASE_MS=10000
export YASH_OBS_RECONNECT_MULTIPLIER=2
export YASH_OBS_RECONNECT_MAX_ATTEMPTS=10
```

Or in `config.json`:

```
{
  "obs": {
    "websocket": {
      "server": "localhost",
      "port": "4455",
      "reconnectBaseMs": 10000,
      "reconnectMultiplier": 2,
      "reconnectMaxAttempts": 10
    }
  }
}
```

Notes: values supplied via environment variables are parsed as strings and cast to numbers by the app where applicable.

CI and secrets
--------------
- For CI, provide secrets via environment variables or a secrets manager (do not commit config.json with credentials).
 - There is also a gitleaks GitHub Action to scan history and PRs for secrets. Review gitleaks results in CI and tune if required.

Notes:
- Use `bun --hot ./src/main.tsx` for the interactive TUI entrypoint in development.

See SPECS.md for architecture and conventions.

Metrics & Prometheus
--------------------
This project exposes lightweight in-memory metrics for CI and local debugging.

- JSON snapshot: GET /api/metrics returns counters, gauges, and timestamps as JSON.
- Prometheus exposition: GET /metrics returns the same metrics in Prometheus text format
  (Content-Type: text/plain; version=0.0.4). This endpoint is intended for scraping by
  CI or lightweight Prometheus setups where data sensitivity is not a concern.

Keys currently exported (examples)
- obs.reconnect.failures (counter)
- obs.reconnect.attempts (counter)
- obs.reconnect.lastAttemptTs (timestamp, ms)
- obs.reconnect.exhausted (counter)
- obs.reconnect.exhaustedTs (timestamp, ms)

Security note: /api/metrics and /metrics are unauthenticated by default. If you plan to
expose them on a public network, add an ACL or authentication layer before enabling scraping.
