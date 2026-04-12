#!/usr/bin/env bash
# Record a simple TUI session using vhs. Requires vhs to be installed.
set -euo pipefail
OUT_DIR="$(pwd)/tmp/tui"
mkdir -p "$OUT_DIR"

echo "Starting TUI in background..."
bun --hot ./src/index.tsx &
TUI_PID=$!
sleep 1

echo "Recording with vhs to $OUT_DIR/demo.tape"
vhs record -o "$OUT_DIR/demo.tape" -- "bash -lc 'printf "\nStarting demo...\n"; sleep 2; printf "Demo end\n"; sleep 1'"

echo "Stopping TUI (pid $TUI_PID)"
kill $TUI_PID || true

echo "Recorded $OUT_DIR/demo.tape"
echo "To render: vhs render $OUT_DIR/demo.tape --out $OUT_DIR/demo.gif"
