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
| TUI window | `yash:all` (window named `all`, always use this target) |
| Start command | `bun start` — always use this; starts TUI + WebUI on port 3000 |
| VHS tapes | Use `YASH_PORT=3001` so recordings never conflict with a live test TUI on 3000 |

## Always target `yash:all` explicitly, never bare `yash`

Bare `-t yash` targets the **active** window, which can change. Window 1 (`yash`) is a general-purpose shell that may be running other things (port conflicts, previous TUI runs, etc.). Always use **`-t yash:all`** — a dedicated window — for every `send-keys`, `display-message`, and `capture-pane` call so the target is unambiguous regardless of which window is active.

If the `bun start` crashes immediately in the all window, the most common cause is **port 3000 already in use** from a previous run. Check with `lsof -ti:3000` and kill the occupying process before retrying.

## How the TUI renders

The TUI draws using cursor-positioning escape codes (NOT alternate-screen mode). This means:

- `tmux capture-pane -p` (no `-S`) only captures the current cursor viewport — it typically returns just the last shell line (e.g. `bun start`), NOT the TUI content.
- **Always use `-S -<N>` to reach the TUI output in the scrollback**, e.g. `tmux capture-pane -t yash:all -p -S -50 2>&1`.
- The pane can have thousands of lines of scrollback history from previous runs. **Never check for box-drawing chars alone** — they may come from old sessions. Always verify using the startup log line `YASH server running`.

## Standard Workflow

### 0. Ensure the all window exists

```bash
# Create the window if it doesn't exist yet (safe to run even if it already exists)
tmux list-windows -t yash | grep -q "all" || tmux new-window -t "yash:2" -n all -c "$(git rev-parse --show-toplevel)"
```

### 1. Check whether the app is running

```bash
# Step 1: process check
tmux display-message -t yash:all -p "#{pane_current_command}"
# Returns "bun" if running, "bash" if stopped

# Step 2: confirm it is the CURRENT run (not old scrollback)
tmux capture-pane -t yash:all -p -S -60 2>&1 | grep "YASH server running"
# Must print a match — this line only appears once per startup
```

Both checks must pass. `pane_current_command=bun` alone is insufficient because:
- A crashed `bun` process might not have exited yet
- Box-drawing chars in scrollback come from previous sessions

### 2. Restart after a code change

```bash
tmux send-keys -t yash:all C-c
sleep 1
tmux send-keys -t yash:all "bun start" Enter
sleep 5
# Verify: process still alive AND startup log present in recent scrollback
tmux display-message -t yash:all -p "#{pane_current_command}"
# Expect: bun
tmux capture-pane -t yash:all -p -S -60 2>&1 | grep "YASH server running"
# Expect: at least one match — confirms this is a live current run, not old history
```

If `YASH server running` is absent but `bun` is still in `pane_current_command`, the app likely crashed during startup. Capture more scrollback to see the error:

```bash
tmux capture-pane -t yash:all -p -S -100 2>&1 | tail -40
```

### 3. Capture the screen

```bash
# Always use -S -<N> to include the TUI content from scrollback
tmux capture-pane -t yash:all -p -S -60 2>&1
```

The TUI uses box-drawing characters (`╭`, `│`, `╰`). Grep for those or specific labels to check state.

## Testing Patterns

### Open a command modal

```bash
# Type the command without pressing Enter, then send Enter separately
tmux send-keys -t yash:all "/stream" && sleep 0.2 && tmux send-keys -t yash:all Enter
sleep 0.5
tmux capture-pane -t yash:all -p -S -50 2>&1 | grep -E "Stream Info|Platforms|Title"
```

### Verify a modal has exclusive input (no background bleed)

This pattern verifies that arrow keys pressed inside a modal do NOT change the background message input:

```bash
# 1. Note the message input line before pressing arrows
BEFORE=$(tmux capture-pane -t yash:all -p -S -50 2>&1 | grep "type a command\|> /\|> [a-z]")

# 2. Open the modal
tmux send-keys -t yash:all "/stream" && sleep 0.2 && tmux send-keys -t yash:all Enter
sleep 0.5

# 3. Press Up/Down several times
tmux send-keys -t yash:all Up Up Up Down Down
sleep 0.3

# 4. Capture message input — must still show placeholder
AFTER=$(tmux capture-pane -t yash:all -p -S -50 2>&1 | grep "type a command\|> /\|> [a-z]")
echo "Before: $BEFORE"
echo "After:  $AFTER"
# If AFTER still shows "type a command" placeholder → exclusive input works ✓

# 5. Close modal
tmux send-keys -t yash:all Escape
```

### Type into a modal field

```bash
# Tab to next field, type text
tmux send-keys -t yash:all Tab
sleep 0.2
tmux send-keys -t yash:all -l "My stream title"
sleep 0.2
tmux capture-pane -t yash:all -p -S -50 2>&1 | grep "My stream title"
```

### Close a modal

```bash
tmux send-keys -t yash:all Escape      # cancel
# or
tmux send-keys -t yash:all Enter       # confirm
```

### Send a chat message

```bash
# Use -l (literal) so tmux does not interpret text as key names
tmux send-keys -t yash:all -l "hello world"
sleep 0.1
tmux send-keys -t yash:all Enter
sleep 0.5
tmux capture-pane -t yash:all -p -S -50 2>&1 | grep "hello world"
```

### Check history cycling (no modal open)

```bash
# Send a message first so history is non-empty
tmux send-keys -t yash:all -l "/help" && tmux send-keys -t yash:all Enter
sleep 0.3

# Press Up — input should fill with the last command
tmux send-keys -t yash:all Up
sleep 0.2
tmux capture-pane -t yash:all -p -S -50 2>&1 | grep "> /"
# Expect to see "> /help" or similar in the message input

# Restore
tmux send-keys -t yash:all Escape 2>/dev/null || tmux send-keys -t yash:all C-c 2>/dev/null
```

### Check the activity bar

The activity bar sits below the status bar and shows the most recent follow/sub/cheer/raid/gift events. Events scroll through automatically; the bar is always visible.

```bash
# Capture and look for an activity entry (platform label + event type)
tmux capture-pane -t yash:all -p -S -60 2>&1 | grep -E "\[(kick|twitch|youtube)\]"
```

To trigger a test event, POST a webhook from another shell:

```bash
# Simulate a Kick follow event
curl -s -X POST http://localhost:3000/api/kick/webhook \
  -H "Content-Type: application/json" \
  -H "Kick-Event-Type: channel.followed" \
  -d '{"data":{"user":{"username":"testuser"}}}'
```

### Open and navigate the /activity modal

```bash
# Open the modal
tmux send-keys -t yash:all -l "/activity" && sleep 0.2 && tmux send-keys -t yash:all Enter
sleep 0.5
tmux capture-pane -t yash:all -p -S -60 2>&1 | grep -E "Activity|\[kick\]|\[youtube\]|\[twitch\]"

# Scroll through entries
tmux send-keys -t yash:all Down
sleep 0.3
tmux send-keys -t yash:all Down
sleep 0.3

# Close
tmux send-keys -t yash:all Escape
sleep 0.3
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
| Clear input line | `C-u` |

## Known Behaviours

- `capture-pane -p` without `-S` returns only the cursor-viewport tail (usually just the shell command line). Always use `-S -60` or more to capture TUI content.
- **Never verify the app is running by counting box-drawing chars** — the pane has thousands of lines of history from old sessions that will produce false positives. Always grep for `YASH server running` in recent scrollback to confirm a live current run.
- Modals (stream, YouTube setup, Kick setup) capture Up/Down so they do not bleed into the main message input history. Use the "exclusive input" pattern above to verify this.
- The message input history cycles on bare Up/Down only when no modal is active.
- **Clearing the main input:** `Ctrl+A` only moves the cursor to the beginning — it does NOT select all. Use `C-u` (`Ctrl+U`) to kill the line from the cursor back to the start, which reliably empties the field. `Ctrl+A` followed by `BSpace` is a no-op and a common mistake in VHS tapes.
- The TUI captures `console.log` — do not use it for debugging; use the logger file transport instead.
