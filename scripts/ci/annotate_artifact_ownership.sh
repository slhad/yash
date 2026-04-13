#!/usr/bin/env bash
set -euo pipefail

# Annotate artifact ownership mismatches in GitHub Actions using workflow
# commands. Reads the validator report JSON (tmp/artifact-ownership-report.txt)
# and emits ::warning annotations for each mismatch so the runner UI highlights
# problematic files.

REPORT_FILE="${1:-tmp/artifact-ownership-report.txt}"
EXPECTED_UID="${2:-$(id -u)}"
EXPECTED_GID="${3:-$(id -g)}"

if [ ! -f "$REPORT_FILE" ]; then
  echo "No ownership report file found at $REPORT_FILE; nothing to annotate"
  exit 0
fi

echo "Annotating ownership mismatches from $REPORT_FILE (expected $EXPECTED_UID:$EXPECTED_GID)"

python3 - <<PY
import json,sys
report_path = sys.argv[1]
expected_uid = sys.argv[2]
expected_gid = sys.argv[3]
try:
    with open(report_path, 'r') as f:
        data = json.load(f)
except Exception as e:
    print(f"Failed to parse report: {e}")
    sys.exit(0)

mismatches = data.get('mismatches', [])
if not mismatches:
    print('No mismatches found')
    sys.exit(0)

for m in mismatches:
    path = m.get('path', '<unknown>')
    uid = m.get('uid', '?')
    gid = m.get('gid', '?')
    msg = f"Artifact ownership mismatch: expected {expected_uid}:{expected_gid} but found {uid}:{gid}"
    # Emit a GitHub Actions warning annotation for the file
    # Ensure the path is safe for the annotation by replacing newlines
    safe_path = path.replace('\n', ' ')
    print(f"::warning file={safe_path}::{msg}")
    # Also print human-readable line to stdout/stderr
    print(f"[ANNOTATION] {safe_path}: {msg}")

PY "$REPORT_FILE" "$EXPECTED_UID" "$EXPECTED_GID"

echo "Annotation step complete"
