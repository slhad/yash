# Agent Guidelines for yash Repository

## Essential Commands

- **Check specifications**: `cat SPECS.md`
- **Read project info**: `cat README.md`
- **List files**: `ls -la`

## Current Project State

This is a minimal repository with:
- README.md: Project title ("Yet Another Streamer Helper")
- SPECS.md: Technical requirements including:
  - UI components from https://github.com/anomalyco/opentui
  - Bun for runtime and testing (`bun run`, `bun test`)
  - Biome for linting/formatting (`biome check --write`)

## Getting Started

When beginning work in this repository:
1. Review SPECS.md for current requirements
2. No build/setup steps are currently defined
3. Follow the specifications for any implementation work
4. **When testing TUI components**: Must use OpenCode pty_spawn/pty_write tools for proper terminal interaction

## Notes

- Repository is intentionally minimal - specifications define the technical stack
- No package.json, lockfiles, or build configurations exist yet
- All implementation should adhere to the requirements in SPECS.md