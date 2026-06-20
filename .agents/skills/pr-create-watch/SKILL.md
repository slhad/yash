---
name: pr-create-watch
description: Create a GitHub PR, include proof/checklist details, then wait briefly for comments/reviews/checks and address new feedback. Use when asked to make/open a PR and watch for comments.
---

# PR Create + Watch Skill

Use this skill when the user asks to create a PR and wait for early comments, reviews, or CI feedback.

## Goal

Open a clean PR with the repository template filled in, push the branch, then monitor the new PR for a short window so immediate Comments, Reviews, and CI/e2e feedback can be fixed before handing back.

## Preconditions

- Working tree contains only intended changes.
- `tmp/` artifacts are not staged.
- Branch is not `master`/`main`; create a topic branch if needed.
- `gh auth status` succeeds.
- Relevant tests/proofs for the change have already been run, or the PR body clearly marks items `N/A — reason`.

## Standard workflow

```bash
# 1. Inspect current branch and changes.
git status --short
git branch --show-current
git diff --stat

# 2. Run required validation for the change.
# Pick targeted tests as appropriate, but PR-ready YASH changes should normally run:
bun run test
bun typecheck
bun run validate:repo

# 3. Create a topic branch if still on master/main.
git checkout -b <type>/<short-topic>

# 4. Stage only intended tracked/docs/skill changes. Never add tmp/.
git add <files>
git status --short

# 5. Commit with a conventional title under 70 chars.
git commit -m "fix: short PR title"

# 6. Push branch.
git push -u origin HEAD

# 7. Write PR body from .github/PULL_REQUEST_TEMPLATE.md.
# For N/A checklist items, check them and include a short reason.
cat > tmp/pr-body.md <<'BODY'
## Summary
- ...

## Proofs of work (Screenshots and Videos)
- ...

## Checklist
- [x] `bun test` — N pass, 0 fail
- [x] `bun run validate:repo` — no tracked demo artifacts/binaries outside `tmp/`
- [x] `bun typecheck` — no errors
- [x] Live TUI check (tmux): ...
- [x] Live Web UI check (playwright): N/A — reason
- [x] Proofs of work for related changes
  - [x] Screenshots inlined with link if any: ...
  - [x] Videos/GIFs for command-line and TUI proof inlined with link if any: N/A — reason
- [x] AGENTS.md updated in affected packages (if new pattern introduced): N/A — reason
- [x] `SPECS.md` updated to reflect any new/changed commands, settings, routes, or behavior
- [x] `README.md` updated if setup, IPC, or architecture changed: N/A — reason
BODY

# 8. Create PR.
gh pr create \
  --title "fix: short PR title" \
  --body-file tmp/pr-body.md \
  --base master \
  --head "$(git branch --show-current)"
```

## Watch for early feedback

After creating the PR, wait 5 minutes unless the user requested another duration. Then fetch current Comments, Reviews, and checks:

```bash
PR=<number>
echo "Waiting 5 minutes for PR comments on #$PR..."
sleep 300

gh pr view "$PR" \
  --json comments,reviews,reviewDecision,statusCheckRollup,url \
  --jq '{
    url,
    reviewDecision,
    comments: [.comments[] | {author:.author.login, body:.body, createdAt:.createdAt}],
    reviews: [.reviews[] | {author:.author.login, state:.state, body:.body, submittedAt:.submittedAt}],
    checks: [.statusCheckRollup[]? | {name:.name, conclusion:.conclusion, status:.status}]
  }'
```

## If feedback arrives

- Read every new Comment and Review.
- Fix requested issues on the same branch.
- Re-run relevant tests/checks.
- Commit and push follow-up fixes.
- If the fix changes behavior, update `SPECS.md`/docs and PR body as needed.
- Re-check the PR after pushing.

## If no feedback arrives

Report:

- PR URL
- comment/review count
- Current check status, especially test, e2e/Playwright, and security checks
- Any known gaps or N/A checklist items

## YASH notes

- Keep PR helper files under `tmp/`, e.g. `tmp/pr-body.md`.
- Do not stage screenshots, videos, casts, or generated proof artifacts from `tmp/`.
- For screenshot proof, use hosted URLs from the `screenshots` release or GitHub user-attachments as appropriate.
- For MP4 PR proof, prefer GitHub `user-attachments` URLs so GitHub renders video inline.
