TUI VHS Recording

This directory contains helper files and scripts to record a terminal demo of the TUI using Charm's `vhs` tool.

Prerequisites
- Install `vhs` (https://github.com/charmbracelet/vhs) and ensure it's on PATH.
- Use Bun to run the TUI entrypoint: `bun --hot ./src/index.tsx` (the TUI main is `src/index.tsx`).

Quick record
1. Make sure the project dependencies are installed: `bun install`
2. Run the record helper: `./record.sh`
3. The script records a tape to `tmp/tui/demo.tape` and prints next steps to render a gif.

Notes
- This directory is gitignored by default (tmp/). The script and instructions are committed so CI or other agents can run them when needed.
