# Contributing

This project uses Bun for development. Keep changes small and focused.

Local setup

1. Install dependencies: `bun install`
2. Run tests: `bun test`
3. Format and lint: `biome check --write`

Development notes

- Use ES module imports. Prefer `import` over `require`.
- Follow SPECS.md for architecture and feature requirements.
- When adding platform providers, implement the `PlatformProvider` interface in `src/platforms/base.ts`.

Creating a PR

- Run `bun install` and `biome check --write` locally.
- Include a short description of the change and why it was made.

Thank you for contributing!
