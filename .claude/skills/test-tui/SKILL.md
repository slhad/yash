---
name: test-tui
description: Test the yash TUI interactively via the tmux session. Use to verify UI behaviour after changes — modals, key input, commands, display state.
---

# Yash TUI Test Skill

Interact with the running yash TUI in the `yash` tmux session to verify behaviour after code changes.

## Session Info

| Key | Value |
|-----|-------|
| Session | `yash` |
| Start command | `bun start` |
| TUI-only mode | `bun run start:tui` |

## How the TUI renders

The TUI draws using cursor-positioning escape codes (NOT alternate-screen mode). This means:

- `tmux capture-pane -p` (no `-S`) only captures the current cursor viewport — it typically returns just the last shell line (e.g. `bun start`), NOT the TUI content.
- **Always use `-S -<N>` to reach the TUI output in the scrollback**, e.g. `tmux capture-pane -t yash -p -S -50 2>&1`.
- The pane can have thousands of lines of scrollback history from previous runs. **Never check for box-drawing chars alone** — they may come from old sessions. Always verify using the startup log line `YASH server running`.

## Standard Workflow

### 1. Check whether the app is running

```bash
# Step 1: process check
tmux display-message -t yash -p "#{pane_current_command}"
# Returns "bun" if running, "bash" if stopped

# Step 2: confirm it is the CURRENT run (not old scrollback)
tmux capture-pane -t yash -p -S -60 2>&1 | grep "YASH server running"
# Must print a match — this line only appears once per startup
```

Both checks must pass. `pane_current_command=bun` alone is insufficient because:
- A crashed `bun` process might not have exited yet
- Box-drawing chars in scrollback come from previous sessions

### 2. Restart after a code change

```bash
tmux send-keys -t yash C-c
sleep 1
tmux send-keys -t yash "bun start" Enter
sleep 5
# Verify: process still alive AND startup log present in recent scrollback
tmux display-message -t yash -p "#{pane_current_command}"
# Expect: bun
tmux capture-pane -t yash -p -S -60 2>&1 | grep "YASH server running"
# Expect: at least one match — confirms this is a live current run, not old history
```

If `YASH server running` is absent but `bun` is still in `pane_current_command`, the app likely crashed during startup. Capture more scrollback to see the error:

```bash
tmux capture-pane -t yash -p -S -100 2>&1 | tail -40
```

### 3. Capture the screen

```bash
# Always use -S -<N> to include the TUI content from scrollback
tmux capture-pane -t yash -p -S -60 2>&1
```

The TUI uses box-drawing characters (`╭`, `│`, `╰`). Grep for those or specific labels to check state.

## Testing Patterns

### Open a command modal

```bash
# Type the command without pressing Enter, then send Enter separately
tmux send-keys -t yash "/stream" && sleep 0.2 && tmux send-keys -t yash Enter
sleep 0.5
tmux capture-pane -t yash -p -S -50 2>&1 | grep -E "Stream Info|Platforms|Title"
```

### Verify a modal has exclusive input (no background bleed)

This pattern verifies that arrow keys pressed inside a modal do NOT change the background message input:

```bash
# 1. Note the message input line before pressing arrows
BEFORE=$(tmux capture-pane -t yash -p -S -50 2>&1 | grep "type a command\|> /\|> [a-z]")

# 2. Open the modal
tmux send-keys -t yash "/stream" && sleep 0.2 && tmux send-keys -t yash Enter
sleep 0.5

# 3. Press Up/Down several times
tmux send-keys -t yash Up Up Up Down Down
sleep 0.3

# 4. Capture message input — must still show placeholder
AFTER=$(tmux capture-pane -t yash -p -S -50 2>&1 | grep "type a command\|> /\|> [a-z]")
echo "Before: $BEFORE"
echo "After:  $AFTER"
# If AFTER still shows "type a command" placeholder → exclusive input works ✓

# 5. Close modal
tmux send-keys -t yash Escape
```

### Type into a modal field

```bash
# Tab to next field, type text
tmux send-keys -t yash Tab
sleep 0.2
tmux send-keys -t yash -l "My stream title"
sleep 0.2
tmux capture-pane -t yash -p -S -50 2>&1 | grep "My stream title"
```

### Close a modal

```bash
tmux send-keys -t yash Escape      # cancel
# or
tmux send-keys -t yash Enter       # confirm
```

### Send a chat message

```bash
tmux send-keys -t yash -l "hello world"
sleep 0.1
tmux send-keys -t yash Enter
sleep 0.5
tmux capture-pane -t yash -p -S -50 2>&1 | grep "hello world"
```

### Check history cycling (no modal open)

```bash
# Send a message first so history is non-empty
tmux send-keys -t yash -l "/help" && tmux send-keys -t yash Enter
sleep 0.3

# Press Up — input should fill with the last command
tmux send-keys -t yash Up
sleep 0.2
tmux capture-pane -t yash -p -S -50 2>&1 | grep "> /"
# Expect to see "> /help" or similar in the message input

# Restore
tmux send-keys -t yash Escape 2>/dev/null || tmux send-keys -t yash C-c 2>/dev/null
```

## Key Sequences Reference

| Key | tmux send-keys value |
|-----|----------------------|
| Up arrow | `Up` |
| Down arrow | `Down` |
| Tab | `Tab` |
| Shift+Tab | `BTab` |
| Enter | `Enter` |
| Escape | `Escape` |
| Ctrl+C | `C-c` |

## Known Behaviours

- `capture-pane -p` without `-S` returns only the cursor-viewport tail (usually just the shell command line). Always use `-S -60` or more to capture TUI content.
- **Never verify the app is running by counting box-drawing chars** — the pane has thousands of lines of history from old sessions that will produce false positives. Always grep for `YASH server running` in recent scrollback to confirm a live current run.
- Modals (stream, YouTube setup, Kick setup) must block arrow key sequences `\x1b[A` (Up) and `\x1b[B` (Down) explicitly. The `modalKeyHandler` in `src/index.tsx` returns `true` for those two sequences to prevent history cycling, but returns `false` for all other unhandled sequences so regular character input still reaches the input fields.
- The message input history cycles on bare Up/Down only when no modal is active.
- The TUI captures `console.log` — do not use it for debugging; use the logger file transport instead.
