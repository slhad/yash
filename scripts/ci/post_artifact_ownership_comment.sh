#!/usr/bin/env bash
set -euo pipefail

# Post a concise PR comment when artifact ownership mismatches are detected.
# Only runs when GITHUB_TOKEN and PR context are available. Otherwise writes a
# local triage file under tmp/ for manual inspection.

REPORT_FILE="${1:-tmp/artifact-ownership-report.txt}"
EXPECTED_UID="${2:-${EXPECTED_UID:-}}"
EXPECTED_GID="${3:-${EXPECTED_GID:-}}"

OUT_FILE="tmp/ci-triage-comment.txt"
mkdir -p "$(dirname "$OUT_FILE")"

if [ ! -f "$REPORT_FILE" ]; then
  echo "No report file at $REPORT_FILE; nothing to post" | tee "$OUT_FILE"
  exit 0
fi

# Read JSON report and decide whether there are mismatches
MISMATCH_COUNT=$(python3 - <<PY
import json,sys
f=sys.argv[1]
try:
    data=json.load(open(f))
except Exception as e:
    print('0')
    sys.exit(0)
print(len(data.get('mismatches',[])))
PY
"$REPORT_FILE")

if [ "$MISMATCH_COUNT" = "0" ] || [ -z "$MISMATCH_COUNT" ]; then
  echo "No ownership mismatches reported (count=$MISMATCH_COUNT)" | tee "$OUT_FILE"
  exit 0
fi

echo "Found $MISMATCH_COUNT ownership mismatches; preparing comment" | tee -a "$OUT_FILE"

# Build comment body with run context and top mismatches
COMMENT_PAYLOAD=$(mktemp)
python3 - <<PY > "$COMMENT_PAYLOAD"
import json,os,sys
report_path = sys.argv[1]
expected_uid = os.environ.get('EXPECTED_UID') or sys.argv[2] or ''
expected_gid = os.environ.get('EXPECTED_GID') or sys.argv[3] or ''
repo = os.environ.get('GITHUB_REPOSITORY','')
workflow = os.environ.get('GITHUB_WORKFLOW','')
run_number = os.environ.get('GITHUB_RUN_NUMBER','')
run_id = os.environ.get('GITHUB_RUN_ID','')
server = os.environ.get('GITHUB_SERVER_URL','https://github.com')
run_url = f"{server}/{repo}/actions/runs/{run_id}" if repo and run_id else ''

with open(report_path) as f:
    data = json.load(f)

mismatches = data.get('mismatches', [])
body_lines = []
body_lines.append('# Artifact ownership mismatches detected')
if run_url:
    body_lines.append(f'**Run:** {run_url} ({workflow} #{run_number})')
body_lines.append('')
body_lines.append(f'**Expected owner:** {expected_uid or data.get("expected_uid","?")}:{expected_gid or data.get("expected_gid","?")}')
body_lines.append('')
body_lines.append('Top mismatches (first 20):')
for m in mismatches[:20]:
    p = m.get('path')
    uid = m.get('uid')
    gid = m.get('gid')
    body_lines.append(f'- `{p}` -> {uid}:{gid}')

if len(mismatches) > 20:
    body_lines.append(f'...and {len(mismatches)-20} more')

body_lines.append('')
body_lines.append('See the CI artifacts for `tmp/artifact-manifest.json`, `tmp/artifact-ownership-report.txt`, and archived tarball for details.')
print(json.dumps({'body': '\n'.join(body_lines)}))
PY "$REPORT_FILE" "$EXPECTED_UID" "$EXPECTED_GID"

echo "Prepared comment payload -> $COMMENT_PAYLOAD" | tee -a "$OUT_FILE"

# Determine PR number from event payload or ref
PR_NUMBER=""
if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "${GITHUB_EVENT_PATH}" ]; then
  PR_NUMBER=$(python3 - <<PY
import json,sys
ev=json.load(open(sys.argv[1]))
pr = ev.get('pull_request', {}).get('number') if isinstance(ev.get('pull_request', {}), dict) else None
if pr:
    print(pr)
    sys.exit(0)
refs = ev.get('refs', {})
print('')
PY "$GITHUB_EVENT_PATH")
fi

# Fallback: try extracting from GITHUB_REF if it contains refs/pull/<num>
if [ -z "$PR_NUMBER" ] && [ -n "${GITHUB_REF:-}" ]; then
  if echo "$GITHUB_REF" | grep -qE '^refs/pull/[0-9]+'; then
    PR_NUMBER=$(echo "$GITHUB_REF" | sed -n 's@refs/pull/\([0-9]\+\)/.*@\1@p')
  fi
fi

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN not set; cannot post comment. Writing payload to $OUT_FILE" | tee -a "$OUT_FILE"
  cat "$COMMENT_PAYLOAD" >> "$OUT_FILE"
  exit 0
fi

if [ -z "$PR_NUMBER" ]; then
  echo "No PR number found in event context; cannot post PR comment. Writing payload to $OUT_FILE" | tee -a "$OUT_FILE"
  cat "$COMMENT_PAYLOAD" >> "$OUT_FILE"
  exit 0
fi

echo "Posting comment to PR #$PR_NUMBER in repo $GITHUB_REPOSITORY" | tee -a "$OUT_FILE"
API_URL="https://api.github.com/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments"

HTTP_RESPONSE=$(mktemp)
curl -sS -H "Authorization: token $GITHUB_TOKEN" -H "Content-Type: application/json" -d @"$COMMENT_PAYLOAD" "$API_URL" -o "$HTTP_RESPONSE" -w "%{http_code}"
HTTP_CODE=$(tail -n1 "$HTTP_RESPONSE" || echo "")
if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
  echo "Comment posted successfully" | tee -a "$OUT_FILE"
else
  echo "Failed to post comment; response code: $HTTP_CODE" | tee -a "$OUT_FILE"
  echo "Response body:" >> "$OUT_FILE"
  cat "$HTTP_RESPONSE" >> "$OUT_FILE" || true
fi

echo "Triage comment file: $OUT_FILE"
exit 0
