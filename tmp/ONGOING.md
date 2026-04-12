Work in progress and actionable items for the repository.

1. Add a short, useful README (done).
2. Keep SPECS.md authoritative for architecture and requirements.
3. Verify CI/test expectations: tests pass locally with Bun. (done)
4. Next improvements:
   - Add CONTRIBUTING.md and development workflow notes.
   - Add simple example showing platform provider usage.
   - Add linting CI step using biome.
   - Run `biome check --write` to format and lint the repo (CI will run this).
   - Ensure `bun test` passes locally; fix failing tests if any.
   - Add integration test notes: ensure config.json is populated for e2e runs.
 - Add GitHub Actions workflow to run `bun install`, `bun test`, and `biome check --write` on PRs.

Action taken:
  - Wrote these next steps into tmp/ONGOING.md as requested by the autonomous agent instruction.

Date: 2026-04-12

Committed by autonomous agent: 2026-04-12T19:39:44Z

New work performed:
 - Added src/utils/config.ts to provide getConfig() used by services (small helper to read config.json).
 - Added initial platform stubs for youtube, twitch, kick (files present but need implementation).

Prioritized next steps (actionable):
1. Implement Platform Providers (high)
   - Complete implementations in src/platforms/youtube.ts, src/platforms/twitch.ts, src/platforms/kick.ts following the PlatformProvider interface in src/platforms/base.ts.
   - Add minimal smoke tests in test/platforms.test.ts verifying provider instantiation and basic metadata methods.

2. Migrate config usage & type-check (high)
   - Replace any CommonJS `require('../utils/config')` with ES module imports where found.
   - Run TypeScript/Bun type-checking (if using TS compiler) or `bun run` to detect runtime import issues.

3. Tests and CI (medium)
   - Ensure unit tests for services using config (test/auth.service.test.ts, test/obs.service.test.ts) pass.
   - Add GitHub Actions workflow to run `bun install`, `biome check --write`, and `bun test` on PRs.

4. Linting and formatting (low)
   - Run `biome check --write` and commit formatting changes.

5. Documentation (low)
   - Add CONTRIBUTING.md with development setup and Bun commands.
   - Add small example showing how to instantiate a PlatformProvider and call AuthService.

Notes and observations:
- SPECS.md is authoritative for architecture and requirements. The project targets Bun, Biome, and OpenTUI.
- tmp/ONGOING.md previously listed TODOs; this update makes them explicit and prioritized so contributors can pick a high-priority task.

Agent: automated edit and commit
