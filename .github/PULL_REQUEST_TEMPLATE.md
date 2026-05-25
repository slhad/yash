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
- What changed and why

<!--
Bullet points: what was added / changed / removed and why.
-->

## Proofs of work (Screenshots and Videos)
- Show what changed where
<!--
Inlined link and description of each proof
links point to artifacts from pre-release "Screenshots & Assets" if done by AI agents (aka copy/paste don't work)
-->

## Checklist

<!-- For items unrelated to this PR, check them [x] with "N/A — reason" rather than leaving them unchecked. -->

- [ ] `bun test` — N pass, 0 fail
- [ ] `bun run validate:repo` — no tracked demo artifacts/binaries outside `tmp/`
- [ ] `bun typecheck` — no errors
- [ ] Live TUI check (tmux): ...
- [ ] Live Web UI check (playwright): ...
- [ ] Proofs of work for related changes <!-- check if N/A -->
  - [ ] Screenshots inlined with link if any (web app proof) <!-- USER : printscreen | AI AGENT use playwright/browser (tools+skills) -->
  - [ ] Videos in mp4 format inlined with link if any (command lines and TUI proof) <!-- USER : record screen | AI AGENT use vhs (skill)-->
- [ ] AGENTS.md updated in affected packages (if new pattern introduced)
- [ ] `SPECS.md` updated to reflect any new/changed commands, settings, routes, or behavior
- [ ] `README.md` updated if setup, IPC, or architecture changed
