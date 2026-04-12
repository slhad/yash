Contributing

Thank you for contributing to YASH. This project uses Bun as the runtime and test
runner. Please follow the minimal guidelines below to make contributions easy to
review and consistent.

Getting started

- Install dependencies: `bun install`
- Run tests: `bun test`
- Run the app (development): `bun run src/index.ts`

Code style

- Formatting and linting are enforced with Biome. Run `biome check --write`
  before creating a PR.

Commits and PRs

- Keep commits small and focused. Use present-tense, short messages that explain
  the why (e.g. "fix: avoid noisy tests by mocking OAuth for Twitch/Kick").
- Create a descriptive PR with a short summary and the reasoning for the
  change. Link any related issues.

Project conventions

- This project targets Bun. Use Bun APIs and avoid Node-specific packages when
  possible.
- Follow the architecture in SPECS.md: platform providers in `src/platforms`,
  services in `src/services`, UI in `src/ui`.

Testing

- Add unit tests under `test/` and ensure they pass locally with `bun test`.
- Integration tests that require external services should be documented and run
  manually; CI may skip them if credentials are not present.

Thank you for helping improve YASH.
