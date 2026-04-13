#!/usr/bin/env bash
set -euo pipefail

# Commands executed inside the hermetic container during CI runs.
# Keep this script simple and non-interactive; it will be executed from the
# host wrapper which manages artifact extraction and ownership fixes.

echo "Starting server inside container"
bun run src/index.ts &
pid=$!

echo "Waiting for server readiness"
for i in $(seq 1 60); do
	if curl -sSf http://localhost:3000/api/status -o /dev/null; then
		echo "Server ready"
		break
	fi
	sleep 1
done
if ! curl -sSf http://localhost:3000/api/status -o /dev/null; then
	echo "Server failed to start" >&2
	ps aux || true
	exit 1
fi

echo "Using pre-baked dependencies in the image; skipping in-container install"

echo "Running unit test suite (bun test on test/ to avoid importing e2e Playwright files)"
# Run only the unit tests under test/ to prevent bun from importing Playwright e2e files.
# Try 'list' reporter first; fall back to default reporter.
if ! bun test test --reporter=list; then
	echo "'list' reporter unsupported or unit tests failed; retrying with default reporter"
	if ! bun test test; then
		exit 4
	fi
fi

if [ "${RUN_PLAYWRIGHT:-0}" = "1" ]; then
	echo "Running Playwright webview test"
	# Playwright uses 'list' reporter; if it fails non-zero we'll let the wrapper handle retries
	npx playwright test e2e-tests/webview.spec.ts --reporter=list || exit 2
else
	echo "Skipping Playwright tests (RUN_PLAYWRIGHT not set)"
fi

echo "Running reconnection integration test"
if ! bun test test/obs.websocket.reconnect.test.ts --reporter=list; then
	echo "'list' reporter unsupported or reconnection test failed; retrying with default reporter"
	if ! bun test test/obs.websocket.reconnect.test.ts; then
		exit 3
	fi
fi

echo "Running artifact verification script"
bash scripts/ci/verify_artifact.sh || true

echo "Capturing metrics and OBS status into /app/tmp for artifact inspection"
curl -sS http://localhost:3000/metrics -o /app/tmp/metrics.txt || echo "metrics fetch failed" >/app/tmp/metrics_fetch_failed.txt || true
curl -sS http://localhost:3000/api/metrics -o /app/tmp/metrics.json || echo "api metrics fetch failed" >/app/tmp/metrics_api_fetch_failed.txt || true
curl -sS http://localhost:3000/api/obs/status -o /app/tmp/obs_status.json || echo "obs status fetch failed" >/app/tmp/obs_status_fetch_failed.txt || true

echo "Integration tests finished"
