# Yet Another Streamer Helper (YASH)

Small toolkit to manage streaming across YouTube, Twitch, and Kick with a
unified interface. Written to run on Bun. This repository contains:

- src/: TypeScript source (platform providers, services, UI)
- test/: Unit and integration tests (run with `bun test`)
- config.json: Example configuration used by integration tests

Quickstart

1. Install dependencies: `bun install`
2. Run tests: `bun test`
3. Launch the TUI (development): `bun run src/index.ts`

See SPECS.md for architecture and conventions.
