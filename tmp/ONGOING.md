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
