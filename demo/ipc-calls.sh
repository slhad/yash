#!/usr/bin/env bash
# IPC demo helper — called by better-ipc.tape
SOCK="${YASH_DATA_DIR:-$HOME/.yash}/yash.sock"
ipc() { (printf '%s\n' "$1"; sleep 1) | socat -t6 - UNIX-CONNECT:"$SOCK"; echo; }

case "$1" in
  list)
    echo "→ list_actions"
    ipc '{"type":"list_actions"}' \
      | jq '.result.data | {count, ids: [.actions[].id]}'
    ;;
  describe)
    echo "→ describe_action: $2"
    ipc "{\"type\":\"describe_action\",\"action\":\"$2\"}" \
      | jq '.result.data | {id, safety, args: (.args|keys)}'
    ;;
  invoke)
    echo "→ invoke_action: marker.create"
    ipc '{"type":"invoke_action","action":"marker.create","args":{"text":"PR demo","platform":"youtube"}}' \
      | jq '{ok, output: .result.output, created: .result.data.created}'
    ;;
  error)
    echo "→ invoke_action: unknown action"
    ipc '{"type":"invoke_action","action":"no.such.action"}' \
      | jq '{ok, error}'
    ;;
  compat)
    echo "→ legacy { command } path"
    ipc '{"command":"/markers youtube 3"}' \
      | jq '{ok, action: .result.action, output: .result.output}'
    ;;
esac
