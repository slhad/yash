Output demo/better-ipc.gif

Require socat
Require jq

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set Padding 14
Set TypingSpeed 45ms

# ── 1: list registered actions ────────────────────────────────────────────────
Type "bash demo/ipc-calls.sh list"
Enter
Sleep 4s

# ── 2: describe an action (full schema, no invoke fn) ────────────────────────
Type "bash demo/ipc-calls.sh describe marker.create"
Enter
Sleep 3500ms

# ── 3: invoke — real marker creation ─────────────────────────────────────────
Type "bash demo/ipc-calls.sh invoke"
Enter
Sleep 9s

# ── 4: error handling — unknown action ───────────────────────────────────────
Type "bash demo/ipc-calls.sh error"
Enter
Sleep 3s

# ── 5: legacy { command } compat path ────────────────────────────────────────
Type "bash demo/ipc-calls.sh compat"
Enter
Sleep 7s

# ── 6: /marker TUI command via bun run cmd ───────────────────────────────────
Type "bun run cmd 'marker PR demo'"
Enter
Sleep 7s

Sleep 2s
