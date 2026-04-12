Contributing

This project uses Bun as the runtime and test runner. Keep contributions small and focused.

Development setup

1. Install dependencies: `bun install`
2. Run tests locally: `bun test`
3. Run the TUI (dev): `bun run src/index.ts`

Guidelines

- Follow the architecture in SPECS.md. Platform providers live in `src/platforms/` and must implement the `PlatformProvider` interface in `src/platforms/base.ts`.
- Run `biome check --write` before opening a PR to format and lint code.
- Keep commits atomic and describe the "why" in the commit message.
- Add unit tests for new behaviors under `test/` using Bun's test harness.

Submitting PRs

- Create a branch per logical change.
- Ensure CI passes (we expect a GitHub Actions workflow to run `bun install`, `biome check --write`, and `bun test`).
- Request at least one review before merging to main.

If you're unsure where to start, check `tmp/ONGOING.md` for prioritized tasks.
