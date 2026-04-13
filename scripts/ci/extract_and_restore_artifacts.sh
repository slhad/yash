#!/usr/bin/env bash
set -euo pipefail

# Extract a tarball created by the CI artifact pipeline and optionally restore
# numeric ownerships based on the embedded artifact-manifest.json. This is a
# consumer-side helper for reproducing CI artifacts locally or on a forensic
# host. It will attempt to use sudo for chown when direct os.chown fails.

usage() {
	echo "Usage: $0 [--no-ownership] <tarball> [dest_dir]" >&2
	echo "  --no-ownership   Extract only; do not attempt to restore UID:GID" >&2
	exit 2
}

restore_ownership=true
if [ "${1:-}" = "--no-ownership" ]; then
	restore_ownership=false
	shift
fi

if [ $# -lt 1 ]; then
	usage
fi

TARFILE="$1"
DEST_DIR="${2:-./tmp/restored-$(date -u +%Y%m%dT%H%M%SZ)}"

if [ ! -f "$TARFILE" ]; then
	echo "Tarball not found: $TARFILE" >&2
	exit 2
fi

mkdir -p "$DEST_DIR"

echo "Extracting $TARFILE -> $DEST_DIR"
tar -xzf "$TARFILE" -C "$DEST_DIR"

echo "Extraction complete. Listing top-level files:"
ls -la "$DEST_DIR" | sed -n '1,200p' || true

MANIFEST="$DEST_DIR/artifact-manifest.json"
REPORT="$DEST_DIR/extract-ownership-report.json"

if [ "$restore_ownership" = true ]; then
	if [ -f "$MANIFEST" ]; then
		echo "Restoring ownerships from manifest: $MANIFEST"

		python3 - "$MANIFEST" "$DEST_DIR" "$REPORT" <<'PY'
import json,os,sys,subprocess
manifest=sys.argv[1]
dest=sys.argv[2]
report_path=sys.argv[3]
results=[]
try:
    data=json.load(open(manifest))
except Exception as e:
    print(json.dumps({'error':str(e)}))
    sys.exit(1)

for e in data:
    p=e.get('path')
    if not p:
        continue
    try:
        uid=int(e.get('uid'))
        gid=int(e.get('gid'))
    except Exception:
        results.append({'path':p,'status':'invalid_uid_gid','uid':e.get('uid'),'gid':e.get('gid')})
        continue
    full=os.path.join(dest,p)
    if not os.path.exists(full):
        results.append({'path':p,'status':'missing'})
        continue
    try:
        os.chown(full, uid, gid)
        results.append({'path':p,'status':'ok','uid':uid,'gid':gid})
    except Exception as ex:
        # attempt sudo chown
        try:
            subprocess.run(['sudo','chown','%d:%d' % (uid,gid), full], check=True)
            results.append({'path':p,'status':'sudo_ok','uid':uid,'gid':gid})
        except Exception as ex2:
            results.append({'path':p,'status':'failed','error':str(ex2)})

json.dump({'results':results}, open(report_path,'w'), indent=2)
print(report_path)
PY

		# Count failures
		failures=$(
			python3 - <<PY
import json,sys
report=sys.argv[1]
data=json.load(open(report))
cnt=0
for r in data.get('results',[]):
    if r.get('status') not in ('ok','sudo_ok'):
        cnt+=1
print(cnt)
PY
			"$REPORT"
		)

		echo "Ownership restoration summary: failures=$failures (see $REPORT)"
		if [ "$failures" -ne 0 ]; then
			echo "Some ownership entries failed to be restored; inspect $REPORT" >&2
			exit 3
		fi
	else
		echo "No manifest found at $MANIFEST; skipping ownership restoration"
	fi
else
	echo "Ownership restoration disabled (--no-ownership); extraction complete"
fi

echo "All done. Restored artifacts are available under: $DEST_DIR"
exit 0
