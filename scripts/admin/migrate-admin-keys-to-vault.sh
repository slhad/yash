#!/usr/bin/env bash
set -euo pipefail

# Safe helper to preview and optionally migrate local admin keys into HashiCorp
# Vault KV v2. This script is conservative: by default it only previews the
# payload that would be written. To perform the migration pass --run and set
# RUN_MIGRATE=1 in the environment.
#
# Usage:
#   ./scripts/admin/migrate-admin-keys-to-vault.sh --preview
#   RUN_MIGRATE=1 ./scripts/admin/migrate-admin-keys-to-vault.sh --run

MODE=${1:---preview}

DATA_DIR="${YASH_DATA_DIR:-${HOME:-.}/.yash}"
ADMIN_FILE="$DATA_DIR/admin_keys.json"
TMPDIR="$(pwd)/tmp"
mkdir -p "$TMPDIR"
BACKUP="$TMPDIR/admin_keys_backup_$(date +%s).json"
PAYLOAD="$TMPDIR/admin_keys_payload.json"

if [[ "$MODE" != "--preview" && "$MODE" != "--run" ]]; then
	echo "Usage: $0 [--preview|--run]" >&2
	exit 1
fi

if [[ ! -f "$ADMIN_FILE" ]]; then
	echo "Admin keys file not found at $ADMIN_FILE" >&2
	exit 2
fi

echo "Backing up existing admin keys to: $BACKUP"
cp "$ADMIN_FILE" "$BACKUP"

# Extract the keys array (file format: { "keys": [ ... ] })
if command -v jq >/dev/null 2>&1; then
	KEYS_JSON=$(jq '.keys' "$ADMIN_FILE" 2>/dev/null || echo '[]')
else
	# Fallback to python for JSON parsing
	KEYS_JSON=$(
		python3 - <<PY
import json,sys
with open('$ADMIN_FILE') as f:
    j=json.load(f)
    keys=j.get('keys',[])
    print(json.dumps(keys))
PY
	)
fi

if [[ -z "$KEYS_JSON" || "$KEYS_JSON" == "null" ]]; then
	KEYS_JSON='[]'
fi

echo "Found $(echo "$KEYS_JSON" | jq 'length' 2>/dev/null || echo 'N/A') admin keys in $ADMIN_FILE"

cat >"$PAYLOAD" <<EOF
{ "data": { "admin-keys": $KEYS_JSON } }
EOF

echo "Preview payload written to: $PAYLOAD"

if [[ "$MODE" == "--preview" ]]; then
	echo "Preview mode: not performing any writes. Inspect $PAYLOAD and $BACKUP to verify."
	exit 0
fi

# --run path below
if [[ "${RUN_MIGRATE:-0}" != "1" ]]; then
	echo "Destructive run requested but RUN_MIGRATE != 1. To perform migration set RUN_MIGRATE=1 and re-run with --run." >&2
	exit 3
fi

if [[ -z "${VAULT_ADDR:-}" || -z "${VAULT_TOKEN:-}" ]]; then
	echo "VAULT_ADDR and VAULT_TOKEN must be set to perform migration." >&2
	exit 4
fi

MOUNT="${VAULT_KV_MOUNT:-secret}"
PATH_KEY="${VAULT_SECRET_PATH:-yash}"
URL="${VAULT_ADDR%/}/v1/${MOUNT}/data/${PATH_KEY}"

echo "Performing migration to Vault at $URL"

HTTP_STATUS=$(curl -s -w "%{http_code}" -o /tmp/migrate_vault_resp.json -X POST -H "X-Vault-Token: ${VAULT_TOKEN}" -H "Content-Type: application/json" --data-binary @"$PAYLOAD" "$URL")

RESP_BODY=$(cat /tmp/migrate_vault_resp.json 2>/dev/null || true)
rm -f /tmp/migrate_vault_resp.json

if [[ "$HTTP_STATUS" -ge 200 && "$HTTP_STATUS" -lt 300 ]]; then
	echo "Migration succeeded. Vault response:"
	echo "$RESP_BODY"
	echo "Backup of local admin file kept at: $BACKUP"
	exit 0
else
	echo "Migration failed with HTTP status $HTTP_STATUS. Response:"
	echo "$RESP_BODY"
	echo "Local backup available at: $BACKUP" >&2
	exit 5
fi
