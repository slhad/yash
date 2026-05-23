<!--
PR title: conventional commits format (becomes the changelog entry)
  feat: short description       → new feature
  fix: short description        → bug fix
  chore: short description      → maintenance, tooling, deps
  docs: short description       → documentation only
  test: short description       → tests only
  refactor: short description   → no behaviour change
Keep it under 70 characters. No period at the end.
-->

## Summary

- What changed and why (1-3 bullets)

## Demo

<!-- TUI: paste hosted VHS GIF link here. Keep local tapes/scripts/GIFs under tmp/ only. -->
<!-- Web UI: paste hosted Playwright GIF link here. Keep local videos/scripts/GIFs under tmp/ only. -->

## Test plan

<!-- For items unrelated to this PR, check them [x] with "N/A — reason" rather than leaving them unchecked. -->

- [ ] `bun test` — N pass, 0 fail
- [ ] `bun run validate:repo` — no tracked demo artifacts/binaries outside `tmp/`
- [ ] `bun typecheck` — no errors
- [ ] Live TUI check (tmux): ...
- [ ] Live Web UI check: ...
- [ ] VHS recording generated from `tmp/` artifacts and linked in Demo (TUI)
- [ ] Playwright recording generated from `tmp/` artifacts and linked in Demo (Web UI)
- [ ] `SPECS.md` updated to reflect any new/changed commands, settings, routes, or behavior
- [ ] `README.md` updated if setup, IPC, or architecture changed
