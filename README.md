# Yet Another Streamer Helper (YASH)

Small toolkit to manage streaming across YouTube, Twitch, and Kick with a
unified interface. Written to run on Bun. This repository contains:

- src/: TypeScript source (platform providers, services, UI)
- test/: Unit and integration tests (run with `bun test`)
- config.json: (local config) Not committed — use config.example.json as a template and create a local config.json with your secrets.

Quickstart

1. Install dependencies: `bun install`
2. Run tests: `bun test`
3. Launch the TUI (development with hot reload): `bun --hot ./src/main.tsx`

Configuration
-------------
This project reads configuration from `config.json` in the repository root during local runs and tests. Do NOT commit secrets.

1. Copy `config.example.json` to `config.json` and update values that are local-only (obs websocket password, stream keys, etc.).
   - `cp config.example.json config.json`
2. Add `config.json` to `.gitignore` if it's not already ignored (this repository's .gitignore already includes `config.json`).

CI and secrets
--------------
- For CI, provide secrets via environment variables or a secrets manager (do not commit config.json with credentials).
 - There is also a gitleaks GitHub Action to scan history and PRs for secrets. Review gitleaks results in CI and tune if required.

Notes:
- Use `bun --hot ./src/main.tsx` for the interactive TUI entrypoint in development.

See SPECS.md for architecture and conventions.
