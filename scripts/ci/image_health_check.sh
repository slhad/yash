#!/usr/bin/env bash
set -euo pipefail

# Lightweight image health check to verify key runtime tools are available and
# accessible to non-root users. Intended to be run inside the hermetic image
# (via docker run --user or via the run_and_collect_artifacts wrapper) and does
# NOT run the test-suite.

echo "=== image_health_check.sh: starting ==="
echo "time: $(date --iso-8601=seconds)"
echo "user: $(id -u):$(id -g) $(id -un 2>/dev/null || true)"
echo "uname: $(uname -a)"

failures=0

check_cmd() {
	local name="$1"
	shift
	echo -n "Checking $name... "
	if "$@" >/dev/null 2>&1; then
		echo "OK"
		return 0
	else
		echo "MISSING/FAILED"
		failures=$((failures + 1))
		return 1
	fi
}

# Check bun
if command -v bun >/dev/null 2>&1; then
	echo "bun: $(bun --version 2>/dev/null || echo 'version unknown') (path: $(command -v bun))"
else
	echo "bun: not found"
	failures=$((failures + 1))
fi

# Check /usr/local/bin/bun symlink
if [ -x /usr/local/bin/bun ]; then
	echo "/usr/local/bin/bun exists and executable"
else
	echo "/usr/local/bin/bun missing or not executable"
	failures=$((failures + 1))
fi

# Node & npx
if command -v node >/dev/null 2>&1; then
	echo "node: $(node --version 2>/dev/null || echo 'version unknown') (path: $(command -v node))"
else
	echo "node: not found"
	failures=$((failures + 1))
fi

if command -v npx >/dev/null 2>&1; then
	echo "npx: $(npx --version 2>/dev/null || echo 'version unknown') (path: $(command -v npx))"
else
	echo "npx: not found"
	failures=$((failures + 1))
fi

# gosu
if command -v gosu >/dev/null 2>&1; then
	echo "gosu: present (path: $(command -v gosu))"
	# try a basic gosu invocation (may return non-zero for some setups); just
	# ensure the binary is runnable
	if gosu --version >/dev/null 2>&1; then
		echo "gosu --version: OK"
	else
		echo "gosu --version: unavailable (binary may still work)"
	fi
else
	echo "gosu: not installed"
	failures=$((failures + 1))
fi

# Playwright browsers path
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright-browsers}"
echo "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
if [ -d "$PLAYWRIGHT_BROWSERS_PATH" ]; then
	echo "Playwright browsers directory exists"
	# list a few entries
	ls -la "$PLAYWRIGHT_BROWSERS_PATH" | sed -n '1,20p' || true
	# Check for expected sibling dirs
	if ls "$PLAYWRIGHT_BROWSERS_PATH"/* 2>/dev/null | grep -q .; then
		echo "Playwright browsers appear present"
	else
		echo "Playwright browsers directory empty"
		failures=$((failures + 1))
	fi
else
	echo "Playwright browsers directory not present"
	failures=$((failures + 1))
fi

# Check that /app/tmp is writable
mkdir -p /app/tmp || true
if touch /app/tmp/.image_health_check_tmp 2>/dev/null && echo ok >/app/tmp/.image_health_check_tmp 2>/dev/null; then
	echo "/app/tmp is writable"
	rm -f /app/tmp/.image_health_check_tmp || true
else
	echo "/app/tmp not writable"
	failures=$((failures + 1))
fi

# Check ci env file presence (if verify_artifact writes it)
if [ -f /app/tmp/ci-env.txt ]; then
	echo "/app/tmp/ci-env.txt present"
else
	echo "/app/tmp/ci-env.txt missing (verify_artifact may not have run)"
fi

echo "=== image_health_check.sh: summary ==="
if [ "$failures" -eq 0 ]; then
	echo "All checks passed"
	exit 0
else
	echo "$failures checks failed"
	exit 2
fi
