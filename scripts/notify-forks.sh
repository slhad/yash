#!/usr/bin/env bash
# Notify forks about planned destructive purge (dry-run by default)
# Usage: sh scripts/notify-forks.sh --owner <owner> --repo <repo> [--confirm]

set -euo pipefail

OWNER=""
REPO=""
CONFIRM=0

while [ "$#" -gt 0 ]; do
	case "$1" in
	--owner)
		OWNER="$2"
		shift 2
		;;
	--repo)
		REPO="$2"
		shift 2
		;;
	--confirm)
		CONFIRM=1
		shift
		;;
	-h | --help)
		echo "Usage: $0 --owner <owner> --repo <repo> [--confirm]"
		exit 0
		;;
	*)
		echo "Unknown arg: $1"
		exit 1
		;;
	esac
done

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
	echo "--owner and --repo are required" >&2
	exit 2
fi

if [ "$CONFIRM" -eq 1 ] && [ -z "${PROVIDE_NOTIFY_TOKEN:-}" ]; then
	echo "To send notifications you must set PROVIDE_NOTIFY_TOKEN env var with a token" >&2
	exit 3
fi

mkdir -p tmp

PAGE=1
PER_PAGE=100
DRY_RUN_LOG=tmp/notify-forks-dryrun.txt
FAIL_LOG=tmp/notify-forks-failures.txt
>"$DRY_RUN_LOG"
>"$FAIL_LOG"

echo "[notify] Enumerating forks (dry-run mode=${CONFIRM==0})"
while :; do
	URL="https://api.github.com/repos/${OWNER}/${REPO}/forks?page=${PAGE}&per_page=${PER_PAGE}"
	if [ -n "${PROVIDE_NOTIFY_TOKEN:-}" ]; then
		AUTH_HDR="-H 'Authorization: token ${PROVIDE_NOTIFY_TOKEN}'"
	else
		AUTH_HDR=""
	fi
	RESP=$(eval "curl -s ${AUTH_HDR} '${URL}'")
	COUNT=$(echo "$RESP" | jq '. | length')
	if [ "$COUNT" -eq 0 ]; then
		break
	fi
	echo "$RESP" | jq -r '.[] | "\(.full_name) \(.html_url) \(.owner.login)"' >>"$DRY_RUN_LOG"
	PAGE=$((PAGE + 1))
done

echo "[notify] Found forks listed in $DRY_RUN_LOG"

if [ "$CONFIRM" -eq 1 ]; then
	echo "[notify] Posting issues to forks (may require repo issues enabled and token permissions)"
	while read -r LINE; do
		FULLNAME=$(echo "$LINE" | awk '{print $1}')
		URL=$(echo "$LINE" | awk '{print $2}')
		OWNER_LOGIN=$(echo "$LINE" | awk '{print $3}')
		ISSUE_BODY="Planned destructive history rewrite for ${OWNER}/${REPO}. See: <link-to-canary> and tmp/purge-simulation-report.txt. Please review migration instructions: <link-to-migration-instructions>."
		POST_URL="https://api.github.com/repos/${FULLNAME}/issues"
		HTTP_RESP=$(curl -s -o /dev/stderr -w "%{http_code}" -X POST -H "Authorization: token ${PROVIDE_NOTIFY_TOKEN}" -H "Content-Type: application/json" -d "{\"title\": \"Planned repository history rewrite - action required\", \"body\": \"${ISSUE_BODY}\"}" "$POST_URL") || true
		if [ "$HTTP_RESP" -ge 200 ] && [ "$HTTP_RESP" -lt 300 ]; then
			echo "Posted issue to ${FULLNAME}"
		else
			echo "Failed to post to ${FULLNAME} (status ${HTTP_RESP})" >>"$FAIL_LOG"
		fi
	done <"$DRY_RUN_LOG"
fi

echo "[notify] Completed. Dry run log: $DRY_RUN_LOG Failures: $FAIL_LOG"
