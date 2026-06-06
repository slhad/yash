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
For screenshots and GIFs, embed the media directly in the PR body with Markdown image syntax so GitHub renders them inline:
![alt text](https://...)

For MP4 videos, use a GitHub `user-attachments` URL and place it on its own line so GitHub renders the player inline.
Plain release asset `.mp4` links usually render as downloads, not embedded video.

If done by AI agents:
- screenshots/GIFs may use hosted URLs from the pre-release "Screenshots & Assets"
- MP4s should use GitHub `user-attachments` URLs, not release asset links
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
