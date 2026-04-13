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

echo "Running full test suite (bun test)"
bun test --reporter=list || exit 4

echo "Running Playwright webview test"
npx playwright test e2e-tests/webview.spec.ts --reporter=list || exit 2

echo "Running reconnection integration test"
bun test test/obs.websocket.reconnect.test.ts --reporter=list || exit 3

echo "Running artifact verification script"
bash scripts/ci/verify_artifact.sh || true

echo "Capturing metrics and OBS status into /app/tmp for artifact inspection"
curl -sS http://localhost:3000/metrics -o /app/tmp/metrics.txt || echo "metrics fetch failed" >/app/tmp/metrics_fetch_failed.txt || true
curl -sS http://localhost:3000/api/metrics -o /app/tmp/metrics.json || echo "api metrics fetch failed" >/app/tmp/metrics_api_fetch_failed.txt || true
curl -sS http://localhost:3000/api/obs/status -o /app/tmp/obs_status.json || echo "obs status fetch failed" >/app/tmp/obs_status_fetch_failed.txt || true

echo "Integration tests finished"
