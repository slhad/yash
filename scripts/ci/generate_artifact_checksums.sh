#!/usr/bin/env bash
set -euo pipefail

# Generate SHA256 checksums for files under the target directory and write
# a JSON array to tmp/artifact-checksums.json. Paths are stored relative to
# the target directory root.

TARGET_DIR="${1:-tmp}"
OUT_FILE="${2:-$TARGET_DIR/artifact-checksums.json}"

mkdir -p "$(dirname "$OUT_FILE")"

python3 - <<PY
import sys,os,hashlib,json
target = sys.argv[1]
out = sys.argv[2]
entries = []
for root, dirs, files in os.walk(target):
    for name in files:
        path = os.path.join(root, name)
        # Skip the output file itself if it lives under target
        try:
            if os.path.abspath(path) == os.path.abspath(out):
                continue
        except Exception:
            pass
        rel = os.path.relpath(path, target)
        try:
            h = hashlib.sha256()
            with open(path, 'rb') as fh:
                while True:
                    chunk = fh.read(8192)
                    if not chunk:
                        break
                    h.update(chunk)
            st = os.stat(path)
            entries.append({
                'path': rel,
                'sha256': h.hexdigest(),
                'size': st.st_size
            })
        except Exception as e:
            # If a file cannot be read, skip it but include an error marker
            entries.append({
                'path': rel,
                'error': str(e)
            })

with open(out, 'w') as f:
    json.dump(entries, f, indent=2)
print('WROTE', out)
PY "$TARGET_DIR" "$OUT_FILE"

echo "Checksum generation complete: $OUT_FILE"
