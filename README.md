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

Admin API
---------
This repository exposes several admin-only endpoints under `/api/admin/*` for
managing encryption keys, exporting tokens, and auditing operations. These
endpoints are protected by `ADMIN_TOKEN` (optional) and support per-IP
allowlisting and rate-limiting via environment variables.

Endpoints (summary):

- POST `/api/admin/rotate-key` : Rotate the symmetric encryption key used to
  encrypt stored tokens. Accepts optional JSON body `{ "key": "..." }` to
  set a specific key (not recommended). Requires admin authorization.
- POST `/api/admin/export-key` : Export the current symmetric key encrypted
  with a provided RSA public key PEM in the request body `{ "publicKeyPem": "..." }`.
  Pass `{ "export": "tokens", "publicKeyPem": "..." }` to export the
  tokens as a hybrid-encrypted package instead.
- POST `/api/admin/keys` : Create a one-time-display admin token. Returns
  `{ id, token, createdAt }` (token shown once).
- GET `/api/admin/keys` : List admin keys metadata (id, label, createdAt, revoked).
- POST `/api/admin/keys/revoke` : Revoke a key by id. Body: `{ "id": "..." }`.
 - POST `/api/admin/keys/import` : Import admin keys exported from another
   instance. Accepts `{ "privateKeyPem": "...", "package": { algorithm, encryptedKey, iv, tag, ciphertext } }`.
   The package must be produced by `exportEncryptedAdminKeys()` from the source
   instance. The import operation merges incoming keys and HMAC metadata so
   tokens issued by the source instance remain verifiable. By default the
   import skips keys with existing IDs (no overwrite).
- GET  `/api/admin/audit/tail?lines=N` : Return the last N lines of the
  append-only audit log (default 100).
- GET  `/api/admin/audit/verify` : Verify the chained HMAC audit log and
  return a result `{ ok: boolean, badIndex?: number }`.

Authentication & environment variables
-------------------------------------
- `ADMIN_TOKEN` : Optional global admin bearer token. If set, clients must send
  `Authorization: Bearer <ADMIN_TOKEN>` unless they present a valid admin key
  created via `/api/admin/keys`.
- `ADMIN_HMAC_KEY` : Key used to HMAC admin tokens (used by AdminService).
- `ADMIN_ALLOWED_IPS` : Comma-separated allowlist (supports `*` and `prefix*`)
  for client IPs.
- `ADMIN_RATE_LIMIT_WINDOW_MS` : Rate-limit window in ms (default: 60000).
- `ADMIN_RATE_LIMIT_REQUESTS` : Allowed requests per window (default: 30).

Audit
-----
The admin API appends best-effort audit entries for sensitive operations. The
audit log is stored under the data directory (default `~/.yash/audit.log`) and
is tamper-evident via a chained HMAC scheme. Do not expose the audit file over
untrusted channels; use the `audit/verify` endpoint to verify integrity.


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

Prometheus naming conventions
---------------------------
When exported to Prometheus format (/metrics), metric names are sanitized and follow these conventions:
- Counters are exported as <sanitized_name>_total (Prometheus counter convention).
- Gauges are exported as <sanitized_name>.
- Timestamps are exported as <sanitized_name>_timestamp_seconds (gauge, seconds since epoch).

Example: counter obs.reconnect.failures -> obs_reconnect_failures_total

Security note: /api/metrics and /metrics are unauthenticated by default. If you plan to
expose them on a public network, add an ACL or authentication layer before enabling scraping.

Optional authentication
-----------------------
If you want to protect the metrics endpoints, set an environment variable `YASH_METRICS_TOKEN`.
When set, both `/api/metrics` (JSON) and `/metrics` (Prometheus text) will require this token.

Accepted authentication methods:
- HTTP header: `Authorization: Bearer <token>`
- HTTP header: `x-api-key: <token>`
- Query parameter: `?token=<token>`

Example (env):

```
export YASH_METRICS_TOKEN=supersecret-token
```

Then access metrics with a header:

```
curl -H "Authorization: Bearer supersecret-token" http://localhost:3000/metrics
```

Using The Prebuilt Hermetic Docker Image
---------------------------------------

We publish a hermetic Docker image that contains Bun, Node (for Playwright tooling), and preinstalled Playwright browsers. The image name is:

```
ghcr.io/<OWNER>/<REPO>/yash-ci:latest
```

Replace `<OWNER>/<REPO>` with your GitHub repository path (the publish workflow tags the image as `ghcr.io/${{ github.repository }}/yash-ci:latest` and `:${{ github.sha }}`).

Quick examples:

- Pull the image:

```
docker pull ghcr.io/<OWNER>/<REPO>/yash-ci:latest
```

- Run the server from the image (mounts the repo `tmp/` to `/app/tmp` inside the container so artifacts can be collected):

```
mkdir -p tmp
docker run --rm -p 3000:3000 -v "$(pwd)/tmp:/app/tmp" --user "$(id -u):$(id -g)" ghcr.io/<OWNER>/<REPO>/yash-ci:latest /bin/bash -lc 'bun run src/index.ts'
```

- CI / hermetic invocation (example taken from the repository CI):

```
docker run --rm -e RUN_PLAYWRIGHT=1 -v "${{ github.workspace }}/tmp:/app/tmp" --user "$(id -u):$(id -g)" ghcr.io/<OWNER>/<REPO>/yash-ci:latest /bin/bash -lc '
  bun run src/index.ts &
  for i in $(seq 1 60); do
    curl -sSf http://localhost:3000/api/status -o /dev/null && break || sleep 1
  done
  # run tests inside the image as needed (Playwright / bun test)
'
```

Notes:
- The CI workflows in `.github/workflows/` already reference this image name. If you mirror or rename the image, update the workflows accordingly.
- The `--user "$(id -u):$(id -g)"` flag ensures files written into the mounted `tmp/` directory are owned by the host runner user so the Actions upload step can read them.

Building the hermetic image with host UID/GID baked in
-----------------------------------------------------

In some CI setups it's helpful to bake a host-matching user into the image at build time so files created by processes in the container already have the correct UID/GID on the host. The Dockerfile supports build args `HOST_UID` and `HOST_GID` for this purpose.

Example:

```
docker build --build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g) -t yash-ci:local .
```

You can also use the local helper which defaults to passing these build args:

```
# Force a rebuild and run the verification script inside the built image
FORCE_BUILD=1 ./scripts/ci/run_hermetic_local.sh

# Explicitly set BUILD_ARGS to control which args are passed
FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh
```

Local hermetic reproduction helper
---------------------------------

If you want to reproduce the hermetic CI run locally (useful for debugging artifact ownership, Playwright failures, or timing issues) there's a helper script at `scripts/ci/run_hermetic_local.sh`.

Usage:

```
# Build image if missing and run the verification script inside the container
./scripts/ci/run_hermetic_local.sh

# Force rebuild of the image before running
FORCE_BUILD=1 ./scripts/ci/run_hermetic_local.sh
```

The script mounts the repository `tmp/` to the container's `/app/tmp` and runs `scripts/ci/verify_artifact.sh` inside the image so you can inspect files and ownership on the host after the run.
