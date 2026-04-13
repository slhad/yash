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

Done this turn
- Expanded metrics to include gauges and timestamps (successes, attempts, lastAttemptTs) and wired additional metrics in ObsService.
- Exposed the richer metrics via /api/obs/status.

Next (candidate) tasks
- Add a dedicated /api/metrics endpoint and a small metrics export format (medium).
- Add CI-level retries around flaky integration steps (medium).
- Add README docs for OBS reconnection config (low).

Done this turn
- Documented OBS reconnection env/config settings in README.md under 'OBS Reconnection & Backoff'.

Next (candidate) tasks
- Implement /api/metrics endpoint returning metrics.getAll() in JSON (easy).
- Add CI-level retries around flaky integration steps (medium).
- Add README examples for CI usage (low).

Done this turn
- Added CI-level retries around Playwright and reconnection tests in .github/workflows/ci.yml (3 attempts each).

Next (candidate) tasks
- Implement /api/metrics endpoint returning metrics.getAll() in JSON (easy).
- Add README examples for CI usage (low).

Done this turn
- Implemented /api/metrics endpoint returning metrics.getAll() in JSON at GET /api/metrics.

Next (candidate) tasks
- Add README examples for CI usage (low).
- Consider adding authentication/ACL for sensitive metrics (low).

Done this turn
- Added Dockerfile and a CI workflow (ci-docker) to build a hermetic image containing Bun and Playwright browsers. The image can run tests locally or in CI where Docker is available.

Next (candidate) tasks
- Use the Docker image in CI to run flaky integration tests in a controlled environment (medium).
- Publish the Docker image to a registry for reproducible CI runs (low).

Done this turn
- Replaced the integration-hermetic job to run inside the Docker image (yash-ci) for better hermeticity.

Next (candidate) tasks
- Verify artifact collection from container-run jobs works across GitHub-hosted runners (medium).
- Consider moving Playwright steps into the Dockerfile to speed CI (low).

Notes
- tmp/ is gitignored; file created to satisfy the workflow requirement. Will be force-added to commit per instruction.

2026-04-13 (this turn)
- Done this turn: Added Prometheus exposition endpoint at GET /metrics in src/index.ts. It converts the in-memory metrics (counters, gauges, timestamps) into Prometheus text format (counters as counter, gauges as gauge, timestamps exported as gauge in seconds).

Next (chosen) task (hard): Convert remaining flaky tests that rely on fake timers to CI-friendly real-time tests.
 - Why: This directly reduces CI flakiness and is a different kind of work than the last two completed tasks (metrics export and hermetic CI image). It requires careful test updates and end-to-end verification in CI-like environment.
 - Plan:
   1. Locate tests that use fake timers (eg. test/obs.reconnect.test.ts, test/obs.websocket.reconnect.test.ts) and update them to use real timers while keeping Math.random deterministic where needed.
   2. Run affected tests locally (bun test) to validate timing-sensitive assertions; adapt timeouts where CI may be slower.
   3. Re-run CI (or run in Docker image) to confirm flakiness resolved.

Next (chosen) task (very hard): Validate hermetic Docker CI job artifact collection end-to-end.
 - Why: Ensuring artifacts produced inside the hermetic container are reliably collected by GitHub Actions (with correct ownership and paths) is critical for CI debugging and test artifact access. This involves Docker run configuration, mount points, and possibly Dockerfile/user handling.
 - Plan:
   1. Inspect .github/workflows/ci.yml and .github/workflows/ci-docker.yml to identify how the hermetic job runs the Docker image, what host paths are mounted (tmp/, workspace), and where artifacts are written inside the container.
   2. Inspect Dockerfile to confirm whether the container runs as root or a created user, and whether file ownership will match the host when files are written to a mounted volume.
   3. Reproduce locally: build the Docker image (Dockerfile) and run the container with the same mounts used in CI (mount host tmp to the container's artifact path). Run the test commands inside and verify generated artifacts exist on the host and have correct ownership/permissions.
   4. If ownership mismatches occur, implement one of:
      - Run the container as the host user (docker run --user $(id -u):$(id -g)) from the CI step, or
      - Create a matching UID/GID user inside the Dockerfile and run tests as that user, or
      - Adjust CI workflow to copy artifacts out of container using docker cp before upload.
   5. Update the CI workflow to reliably upload artifacts (actions/upload-artifact) from the mounted host path and add a smoke-check step that lists artifact files after the container run.
   6. Document the final approach in README and tmp/ONGOING.md, and add a small CI job to validate artifact collection periodically.

Notes:
 - This task requires Docker on the runner; if GitHub-hosted runners are used, prefer the Docker-based CI job that already exists. If using self-hosted runners, confirm Docker is available.
- I will begin by inspecting the CI workflows and Dockerfile and then reproduce locally. Proceeding now.

Done this turn:
- Added scripts/ci/verify_artifact.sh which writes a small CI artifact to /app/tmp inside the container and prints its ownership/permissions. This will be used to validate that files written inside the hermetic container into a mounted host directory appear on the host with correct ownership.

Next steps (immediate):
1. Update .github/workflows/ci.yml (integration-hermetic job) so the container run invokes the verification script after tests to create the artifact under the mounted /app/tmp. This lets the workflow upload the artifact and we can assert its ownership.
2. Commit scripts/ci/verify_artifact.sh and the CI workflow change (leave tmp/ uncommitted).
3. Optionally run the hermetic docker job locally (docker build + docker run with same mount and --user flags) to verify artifact ownership and adjust approach if necessary (create UID/GID inside image or use --user).

Next (chosen) task (hard but different from last two): Add optional token-based authentication for metrics endpoints and document it.
 - Why: It addresses a security concern (metrics exposure) and is a different follow-up from recent CI and metrics export work.
 - Plan:
   1. Add environment-driven token check (YASH_METRICS_TOKEN) to /api/metrics and /metrics.
   2. Accept Bearer auth, x-api-key header, or ?token=<token> query param.
   3. Document usage in README and record steps in tmp/ONGOING.md.
   4. Commit the code changes (excluding tmp/).

Done this turn:
 - Implemented token-based auth for /api/metrics (JSON) and /metrics (Prometheus) in src/index.ts. When YASH_METRICS_TOKEN is set, endpoints require the token via Authorization (Bearer), x-api-key header, or ?token=<token>.
 - Updated README.md with instructions and examples for YASH_METRICS_TOKEN.

Next (chosen) task (hard, different from last two): Add CI automation to publish the hermetic Docker image (yash-ci) to a registry so CI runs can use the prebuilt image.
 - Why: Publishing the Docker image improves CI reliability and speeds up runs because the image already contains Bun and Playwright browsers. This is different from the last two tasks which focused on metrics auth and artifact verification.
 - Plan:
   1. Add a GitHub Actions workflow to build and push the Docker image to GitHub Container Registry (ghcr.io) on pushes to main/master and on semver tags.
   2. Ensure the image is tagged with :latest and the current commit SHA.
   3. Add cache-from/cache-to to speed up builds.
   4. Document usage in README and tmp/ONGOING.md and commit the workflow.

Done this turn:
- Added .github/workflows/docker-publish.yml which builds and pushes yash-ci to ghcr.io/${{ github.repository }}/yash-ci:latest and :${{ github.sha }}.

Next (chosen) task (hard and different from last two): Add an automated smoke job that runs after the image is published to validate the published image can be pulled and used by CI.
 - Why: This ensures the published artifact is usable and can run the hermetic tests in CI without requiring a fresh build every time.
 - Plan:
   1. Create a workflow triggered by `workflow_run` of the publish job that pulls ghcr.io/${{ github.repository }}/yash-ci:latest and runs the smoke steps (server, quick Playwright smoke, reconnection smoke, artifact verification).
   2. Upload tmp/** artifacts so the results and verification files are available for inspection.
   3. Commit the workflow and document the expectation in README and tmp/ONGOING.md.

Done this turn:
- Added .github/workflows/hermetic-smoke.yml which runs after the publish workflow completes and performs a hermetic smoke run using the published image (uploads tmp/** artifacts).

Next (chosen) task (hard and different from last two): Add a small utility to centralize Prometheus text exposition generation in src/utils/metrics.ts and use it from the /metrics endpoint. This improves testability and keeps formatting consistent.
 - Why: We've added multiple places that reimplement Prometheus text formatting; centralizing it reduces duplication and makes it easier to test.
 - Plan:
   1. Add a helper function `toPrometheusText(snapshot?)` in src/utils/metrics.ts that converts snapshots to Prometheus text.
   2. Update the /metrics handler in src/index.ts to call the helper.
   3. Commit the changes (tmp/ remains uncommitted).

Done this turn:
- Implemented `toPrometheusText` in src/utils/metrics.ts.
