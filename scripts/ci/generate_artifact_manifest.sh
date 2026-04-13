#!/usr/bin/env bash
set -euo pipefail

# Generate a JSON manifest of files under the target directory including
# ownership (uid:gid), mode, size and mtime. Intended to run on the host
# (CI runner) after artifacts have been copied into tmp/.

TARGET_DIR="${1:-tmp}"
OUT_FILE="${2:-$TARGET_DIR/artifact-manifest.json}"

if [ ! -d "$TARGET_DIR" ]; then
	echo "Target directory '$TARGET_DIR' does not exist" >&2
	exit 1
fi

echo "Generating artifact manifest for: $TARGET_DIR -> $OUT_FILE"

# Use python3 to reliably produce JSON; ubuntu-latest provides python3.
find "$TARGET_DIR" -type f -print0 |
	python3 - <<'PY' >"$OUT_FILE"
import sys, os, json
data = []
raw = sys.stdin.buffer.read().split(b"\x00")
for b in raw:
    if not b:
        continue
    p = b.decode('utf-8')
    try:
        st = os.stat(p)
    except FileNotFoundError:
        continue
    data.append({
        'path': p,
        'uid': st.st_uid,
        'gid': st.st_gid,
        'mode': oct(st.st_mode & 0o777),
        'size': st.st_size,
        'mtime': st.st_mtime,
    })
print(json.dumps(data, indent=2))
PY

echo "WROTE $OUT_FILE (entries: $(jq -r 'length' "$OUT_FILE" 2>/dev/null || echo '?'))"
