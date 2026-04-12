Purge-prep: git-filter-repo replacement file and instructions
===========================================================

I added an executable helper at `scripts/purge-secrets.sh` that prepares a replacements file
for `git-filter-repo`, prints manual steps to perform a mirror-based destructive purge, and
supports an optional `--execute` mode that is double-locked (requires CONFIRM_PURGE=1).

This is intentionally conservative. Do NOT run the destructive purge until:
1. All secrets are rotated.
2. You have a vetted backup of the repository.
3. You have coordinated with all repository collaborators.

To prepare a purge file, create a secrets.txt with one secret per line and run:

  sh scripts/purge-secrets.sh --secrets-file secrets.txt

To execute the purge (DANGEROUS):

  CONFIRM_PURGE=1 sh scripts/purge-secrets.sh --secrets-file secrets.txt --execute

After purge completes, force-push rewritten history and inform collaborators to re-clone.
