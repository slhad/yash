Output demo/obs-shutdown.gif

Require bash
Require bun
Require tmux
Require socat
Require jq

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 24
Set Padding 14
Set WindowBar Colorful

# ── Setup: launch yash in demo mode (detached tmux) ──────────────────────────
Hide
Type "cd /home/slash/dev/git/yash"
Enter
Sleep 200ms
Type "tmux kill-session -t obs-shutdown-demo 2>/dev/null; true"
Enter
Sleep 200ms
Type "YASH_DEMO=true tmux new-session -d -s obs-shutdown-demo -c /home/slash/dev/git/yash 'bun start'"
Enter
Sleep 16s
Show

# ── 1: discover obs actions via IPC ──────────────────────────────────────────
Type "bash demo/obs-shutdown.sh list"
Enter
Sleep 4s

# ── 2: initiate shutdown countdown (30s, Ending scene) ───────────────────────
Type "bash demo/obs-shutdown.sh initiate"
Enter
Sleep 4s

# ── 3: check status mid-countdown ────────────────────────────────────────────
Type "bash demo/obs-shutdown.sh status"
Enter
Sleep 4s

# ── 4: cancel before stream stops ────────────────────────────────────────────
Type "bash demo/obs-shutdown.sh cancel"
Enter
Sleep 3s

# ── 5: confirm countdown is gone ─────────────────────────────────────────────
Type "bash demo/obs-shutdown.sh status"
Enter
Sleep 3s

Sleep 1s

# Cleanup
Hide
Type "tmux kill-session -t obs-shutdown-demo 2>/dev/null; true"
Enter
Sleep 200ms
Show
