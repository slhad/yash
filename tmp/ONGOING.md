Work in progress and actionable items for the repository.

Notes and observations:
- SPECS.md is authoritative for architecture and requirements. The project targets Bun, Biome, and OpenTUI.
- tmp/ONGOING.md previously listed TODOs; this update makes them explicit and prioritized so contributors can pick a high-priority task.

Next steps (autonomous agent executed):
1. Run tests locally with `bun test`. Record failing tests and group them by area (auth, logger, obs, stream, platforms, etc.).
2. Fix high-priority test failures starting with utils/logger and tests that assert log output formatting.
3. Validate TypeScript build with `bun build` and fix any typing/build errors in `src/` files.
4. Run the app (`bun --hot ./src/main.tsx`) and capture runtime console errors; document reproducible issues.
5. Open small focused PRs for each fix; include tests when possible and clear commit messages.

Short-term actionable tasks (pick one):
- Fix logger formatting so tests expecting `[DEBUG]` and message content pass. Inspect: `src/utils/logger.ts`, `tests/logger.test.ts`, `test/logger.test.ts`.
- Repair failing auth service tests. Inspect: `src/services/auth.service.ts`, `test/auth.service.test.ts`.
- Add missing exports in `src/platforms/index.ts` if `test/platforms.test.ts` is failing.

Notes:
- I will commit this `tmp/ONGOING.md` update now as requested.
- To proceed with running tests and fixing issues, reply with: "Proceed: run tests and fix failures".

Agent: automated edit and commit
