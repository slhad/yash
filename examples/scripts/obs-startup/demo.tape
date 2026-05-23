Output obs-startup.gif

Require bash
Require bun

Set Shell "bash"
Set FontSize 14
Set Width 1400
Set Height 900
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 24
Set Padding 14
Set WindowBar Colorful

Hide
Type "cd /home/slash/dev/git/yash"
Enter
Sleep 300ms

Type "YASH_PORT=3001 YASH_TUI_ONLY=1 bun run src/index.tsx 2>/dev/null"
Enter
Sleep 16s
Show

# 1. Status — no active sequence
Type "/action obs.startup.status"
Enter
Sleep 2s

# 2. Begin with 12s delay — watch chat messages
Ctrl+U
Sleep 300ms
Type "/action obs.startup.begin delay=12"
Enter
Sleep 2s

# 3. Status mid-countdown (while in countdown phase)
Ctrl+U
Sleep 300ms
Type "/action obs.startup.status"
Enter
Sleep 2s

# Wait for countdown to reach ~6s (12 - 6 = 6s from start)
Sleep 4s

# 4. Cancel mid-countdown
Ctrl+U
Sleep 300ms
Type "/action obs.startup.cancel"
Enter
Sleep 2s

# 5. Restart cleanly
Ctrl+U
Sleep 300ms
Type "/action obs.startup.begin delay=8"
Enter

# Watch final countdown fire at 5s and go-live
Sleep 11s

Ctrl+C
Sleep 1s
