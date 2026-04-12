Purge Commit Migration & Local Branch Remap (tracked)

Purpose:
- Provide guidance and tooling to help contributors map old commit SHAs to rewritten commit SHAs and migrate local branches safely after a destructive rewrite.

Overview:
- We will generate tmp/commit-map.txt (best-effort mapping) and provide helper scripts to produce per-branch migration instructions. Automated remapping is risky; prefer re-clone + cherry-pick for most contributors.

Files & scripts:
- scripts/generate-commit-map.mjs — creates tmp/commit-map.txt using heuristic matching of commit subject, author, and date.
- scripts/migrate-local-branches.sh — dry-run by default; prints per-branch migration steps and can create migrated/* branches when --apply is passed.

Operator guidance:
- Generate commit map in the exec/simulation environment, vet it manually, and publish it to tmp/commit-map.txt and .github/ONGOING_PURGE_COMMIT_MIGRATION.md for contributors to reference.
- Ensure maintainers and core contributors are briefed before any automated migration is attempted.
