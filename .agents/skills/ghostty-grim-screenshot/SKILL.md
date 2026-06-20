---
name: ghostty-grim-screenshot
description: Capture high-quality PNG screenshots of a Ghostty/tmux terminal window on Hyprland using hyprctl + grim. Use for YASH TUI UI refactoring/fix proof when tmux text capture is not enough.
---

# Ghostty + grim Screenshot Skill

Capture a high-quality still image of the live Ghostty terminal that contains the `yash` tmux TUI. Use this when a visual proof is needed for TUI refactoring, spacing, borders, colors, inline images, or layout issues that `tmux capture-pane` cannot show accurately.

## When to use

Use this skill for:

- before/after screenshots during YASH TUI refactoring
- visual verification of modal spacing, borders, colors, and status bars
- documenting regressions where text-only tmux capture is insufficient
- PR proof screenshots that should be crisp and representative of the actual terminal

For behavior assertions that only need text, prefer the `/test-live` skill and `tmux capture-pane` first.

## Artifacts policy

Always write screenshots under `tmp/`, for example:

```bash
tmp/screenshots/yash-ui-before.png
tmp/screenshots/yash-ui-after.png
```

Never commit these screenshots. `tmp/` is gitignored and is the correct place for temporary proof artifacts.

## Prerequisites

The local desktop session must have:

- Hyprland (`hyprctl`)
- Ghostty
- `grim`
- `jq`
- an existing Ghostty window running the relevant tmux pane, usually `yash:all`

Optional but useful:

- `file` for image metadata checks
- `pngcheck` or ImageMagick for deeper image validation

## Standard YASH capture command

This focuses the Ghostty window that appears to contain the YASH tmux session, reads the active window geometry from Hyprland, and captures that rectangle with `grim`. Prefer title matching over "first Ghostty window" because pi/agent shells may also run in Ghostty:

```bash
mkdir -p tmp/screenshots

out=${OUT:-tmp/screenshots/yash-ui.png}
addr=$(hyprctl clients -j | jq -r '.[] |
  select(
    ((.class | ascii_downcase) == "com.mitchellh.ghostty" or (.class | ascii_downcase) == "ghostty")
    and (.title | test("tmux new-session -s yash|yash:all|bun start|YASH"))
  ) |
  .address' | head -n1)

if [ -z "$addr" ]; then
  echo "No YASH Ghostty window found. Available Ghostty windows:" >&2
  hyprctl clients -j | jq -r '.[] |
    select((.class | ascii_downcase) == "com.mitchellh.ghostty" or (.class | ascii_downcase) == "ghostty") |
    [.address, .workspace.name, .title] | @tsv' >&2
  exit 1
fi

hyprctl dispatch focuswindow "address:$addr" >/dev/null
sleep 0.2

geom=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
title=$(hyprctl activewindow -j | jq -r '.title')
echo "capturing Ghostty title=$title geometry: $geom -> $out"

grim -g "$geom" "$out"
file "$out"
ls -lh "$out"
```

## Recommended before/after workflow

```bash
mkdir -p tmp/screenshots

# 1. Make sure the live TUI is in the intended state.
tmux display-message -t yash:all -p '#{pane_current_command}'
tmux capture-pane -t yash:all -p -S -60 2>&1 | grep 'YASH server running'

# 2. Capture before.
OUT=tmp/screenshots/yash-ui-before.png bash -c '
addr=$(hyprctl clients -j | jq -r '\''.[] | select(((.class | ascii_downcase) == "com.mitchellh.ghostty" or (.class | ascii_downcase) == "ghostty") and (.title | test("tmux new-session -s yash|yash:all|bun start|YASH"))) | .address'\'' | head -n1)
[ -n "$addr" ] || { echo "No YASH Ghostty window found" >&2; exit 1; }
hyprctl dispatch focuswindow "address:$addr" >/dev/null
sleep 0.2
geom=$(hyprctl activewindow -j | jq -r '\''"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"'\'')
grim -g "$geom" "$OUT"
file "$OUT"
'

# 3. Apply the UI change and restart/re-render YASH.

# 4. Capture after with the same terminal size and app state.
OUT=tmp/screenshots/yash-ui-after.png bash -c '
addr=$(hyprctl clients -j | jq -r '\''.[] | select(((.class | ascii_downcase) == "com.mitchellh.ghostty" or (.class | ascii_downcase) == "ghostty") and (.title | test("tmux new-session -s yash|yash:all|bun start|YASH"))) | .address'\'' | head -n1)
[ -n "$addr" ] || { echo "No YASH Ghostty window found" >&2; exit 1; }
hyprctl dispatch focuswindow "address:$addr" >/dev/null
sleep 0.2
geom=$(hyprctl activewindow -j | jq -r '\''"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"'\'')
grim -g "$geom" "$OUT"
file "$OUT"
'
```

## Notes on scaling

Hyprland reports window geometry in logical coordinates, while `grim` writes physical pixels. On scaled displays this means the PNG dimensions can be larger than the `hyprctl activewindow -j` size. Treat this as expected and useful for high-quality screenshots, not as a capture error.

Example observed result:

```text
hyprctl geometry: 1922,28 1148x1266
grim PNG:         1913x2110
```

## Troubleshooting

### No Ghostty window found

Check the class names Hyprland sees:

```bash
hyprctl clients -j | jq -r '.[] | [.class, .title, .address] | @tsv'
```

If your Ghostty class differs, adjust the selector in the command.

### Captured the wrong Ghostty window

This usually means the title matcher did not identify the YASH/tmux Ghostty window. List available Ghostty windows and update the title regex if needed:

```bash
hyprctl clients -j | jq -r '.[] |
  select((.class | ascii_downcase) == "com.mitchellh.ghostty" or (.class | ascii_downcase) == "ghostty") |
  [.address, .workspace.name, .title] | @tsv'
```

If multiple Ghostty windows are open and title matching is still ambiguous, focus the intended one manually first, then capture the active window directly:

```bash
mkdir -p tmp/screenshots
geom=$(hyprctl activewindow -j | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"')
grim -g "$geom" tmp/screenshots/yash-ui.png
```

### Need only a selected region

Use `slurp` for manual region selection:

```bash
grim -g "$(slurp)" tmp/screenshots/yash-ui-region.png
```

### Need to inspect the image from pi

Use the `read` tool on the PNG path, for example:

```text
tmp/screenshots/yash-ui.png
```

Then describe the visible UI state and keep the path in the final proof notes.

## Lessons from the OBS audio-routing TUI refactor

Useful screenshot names from the live hierarchy/input-focus iteration:

```text
tmp/screenshots/obs-audio-routing-config-tui-yash.png
tmp/screenshots/obs-audio-routing-config-tui-hierarchy-v3.png
tmp/screenshots/obs-audio-routing-config-tui-no-pipes.png
tmp/screenshots/obs-audio-routing-config-tui-aligned-keys.png
tmp/screenshots/obs-audio-routing-config-tui-input-focus-marker.png
```

When testing focus and alignment changes, first drive the TUI with tmux, then capture the visual proof:

```bash
tmux send-keys -t yash:all C-u
tmux send-keys -t yash:all -l '/action obs-audio-routing.config.tui'
tmux send-keys -t yash:all Enter
sleep 1
# Optional: Tab to the row whose focus cue/alignment needs proof.
tmux send-keys -t yash:all Tab Tab Tab
sleep 0.2
OUT=tmp/screenshots/obs-audio-routing-config-tui-input-focus-marker.png bash -c '<paste the standard YASH capture command body here>'
```
