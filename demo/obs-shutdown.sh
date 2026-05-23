#!/usr/bin/env bash
# OBS shutdown demo helper — called by obs-shutdown.tape
SOCK="${YASH_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/yash}/yash.sock"
ipc() { (printf '%s\n' "$1"; sleep 1) | socat -t6 - UNIX-CONNECT:"$SOCK"; echo; }

case "$1" in
  list)
    echo "→ list IPC actions (obs domain)"
    ipc '{"type":"list_actions","details":true}' \
      | jq '.result.data.actions[] | select(.domain == "obs") | {id, voiceHint, safety}'
    ;;
  initiate)
    echo "→ invoke: obs.shutdown.initiate"
    ipc '{"type":"invoke_action","action":"obs.shutdown.initiate","args":{"delay":30,"scene":"Ending"}}' \
      | jq '{ok, output: .result.output, data: .result.data}'
    ;;
  status)
    echo "→ invoke: obs.shutdown.status"
    ipc '{"type":"invoke_action","action":"obs.shutdown.status"}' \
      | jq '{ok, data: .result.data}'
    ;;
  cancel)
    echo "→ invoke: obs.shutdown.cancel"
    ipc '{"type":"invoke_action","action":"obs.shutdown.cancel"}' \
      | jq '{ok, output: .result.output}'
    ;;
esac
