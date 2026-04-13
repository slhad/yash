#!/usr/bin/env bash
set -euo pipefail

# Validate artifact manifest JSON produced by scripts/ci/generate_artifact_manifest.sh
# Exits 0 if all files are owned by the expected UID:GID, non-zero otherwise.

MANIFEST="${1:-tmp/artifact-manifest.json}"
EXPECTED_UID="${2:-$(id -u)}"
EXPECTED_GID="${3:-$(id -g)}"
REPORT_FILE="${4:-tmp/artifact-ownership-report.txt}"

if [ ! -f "$MANIFEST" ]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

echo "Validating artifact manifest: $MANIFEST against expected UID:GID $EXPECTED_UID:$EXPECTED_GID"

python3 - <<PY > "$REPORT_FILE"
import json,sys
manifest_path = sys.argv[1]
expected_uid = int(sys.argv[2])
expected_gid = int(sys.argv[3])
out = { 'expected_uid': expected_uid, 'expected_gid': expected_gid, 'mismatches': [] }
try:
    with open(manifest_path, 'r') as f:
        data = json.load(f)
except Exception as e:
    print('error: failed to read manifest: %s' % e)
    sys.exit(2)

for entry in data:
    uid = int(entry.get('uid', -1))
    gid = int(entry.get('gid', -1))
    if uid != expected_uid or gid != expected_gid:
        out['mismatches'].append({ 'path': entry.get('path'), 'uid': uid, 'gid': gid })

print(json.dumps(out, indent=2))
if out['mismatches']:
    sys.exit(2)
else:
    sys.exit(0)
PY "$MANIFEST" "$EXPECTED_UID" "$EXPECTED_GID"

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
  echo "All artifact files are owned by $EXPECTED_UID:$EXPECTED_GID" >&2
else
  echo "Ownership mismatches found; see $REPORT_FILE" >&2
fi

exit $EXIT_CODE
