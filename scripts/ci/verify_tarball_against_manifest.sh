#!/usr/bin/env bash
set -euo pipefail

# Verify that a tarball contains the files listed in the artifact manifest and
# that their SHA256 checksums match the generated checksums. Exits 0 on success
# and non-zero if missing files or checksum/size mismatches are found.

TARFILE="${1:-}"
MANIFEST_PATH="${2:-tmp/artifact-manifest.json}"
CHECKSUMS_PATH="${3:-tmp/artifact-checksums.json}"
REPORT_PATH="${4:-tmp/tar-verification-report.json}"

if [ -z "$TARFILE" ]; then
  echo "Usage: $0 <tarball> [manifest.json] [checksums.json] [report.json]" >&2
  exit 2
fi

if [ ! -f "$TARFILE" ]; then
  echo "Tarball not found: $TARFILE" >&2
  exit 2
fi

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Manifest not found: $MANIFEST_PATH" >&2
  exit 2
fi

echo "Verifying tarball: $TARFILE against manifest: $MANIFEST_PATH and checksums: $CHECKSUMS_PATH"

python3 - <<PY
import sys, subprocess, json, hashlib, os
tar = sys.argv[1]
manifest_path = sys.argv[2]
checksums_path = sys.argv[3]
report_path = sys.argv[4]

def list_tar_entries(tarfile):
    p = subprocess.run(['tar','-tf',tarfile], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError('tar -tf failed')
    entries = [line.lstrip('./') for line in p.stdout.splitlines() if line.strip()]
    return entries

entries = list_tar_entries(tar)
entries_set = set(entries)

with open(manifest_path, 'r') as f:
    manifest = json.load(f)

checks = {}
if os.path.exists(checksums_path):
    try:
        data = json.load(open(checksums_path))
        for e in data:
            checks[e.get('path')] = e.get('sha256')
    except Exception:
        checks = {}

report = {'missing': [], 'checksum_mismatches': [], 'size_mismatches': [], 'checked': 0, 'errors': []}

for entry in manifest:
    path = entry.get('path')
    if not path:
        continue
    report['checked'] += 1
    if path not in entries_set:
        report['missing'].append(path)
        continue
    try:
        # Stream file contents from tar and compute sha256 and size
        h = hashlib.sha256()
        p = subprocess.Popen(['tar','-Oxzf',tar, path], stdout=subprocess.PIPE)
        total = 0
        while True:
            chunk = p.stdout.read(8192)
            if not chunk:
                break
            total += len(chunk)
            h.update(chunk)
        p.wait()
        sha = h.hexdigest()
    except Exception as e:
        report['errors'].append({'path': path, 'error': str(e)})
        continue

    expected_size = entry.get('size')
    if expected_size is not None and int(expected_size) != total:
        report['size_mismatches'].append({'path': path, 'expected': expected_size, 'actual': total})

    expected_sha = checks.get(path)
    if expected_sha and expected_sha != sha:
        report['checksum_mismatches'].append({'path': path, 'expected': expected_sha, 'actual': sha})

with open(report_path, 'w') as f:
    json.dump(report, f, indent=2)

exit_code = 0
if report['missing'] or report['checksum_mismatches'] or report['size_mismatches']:
    exit_code = 3
print('WROTE', report_path)
sys.exit(exit_code)
PY "$TARFILE" "$MANIFEST_PATH" "$CHECKSUMS_PATH" "$REPORT_PATH"

EXIT=$?
if [ $EXIT -ne 0 ]; then
  echo "Tar verification failed (exit=$EXIT) - see $REPORT_PATH" >&2
  exit $EXIT
else
  echo "Tar verification passed"
  exit 0
fi
