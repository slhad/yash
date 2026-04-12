Purge Preparation (safe, non-destructive)

Summary
-------
This file mirrors the local tmp/ONGOING.md record describing the results of running
scripts/prepare-purge-replacements.js and the recommended next steps prior to any
destructive history rewrite.

Artifacts created (untracked)
--------------------------------
- tmp/replacements.txt
- tmp/secret-locations.txt

What I did
---------
- Executed scripts/prepare-purge-replacements.js which scanned tracked files for likely
  secret-looking patterns and produced a list of candidate values to replace. The script
  found 36 unique candidate values. Files are intentionally created in tmp/ and are not
  committed.

Recommended next steps (do NOT execute destructive actions until credentials rotated)
------------------------------------------------------------------------------------
1. Inspect tmp/replacements.txt and tmp/secret-locations.txt and remove false positives.
2. Rotate any credentials that were actually exposed.
3. Optionally enhance tmp/replacements.txt with any additional values to purge.
4. Run `sh scripts/purge-secrets.sh --secrets-file tmp/replacements.txt` to preview the commands.
5. If ready and CONFIRM_PURGE=1 is set, run `sh scripts/purge-secrets.sh --secrets-file tmp/replacements.txt --execute`.

Important
---------
- The destructive purge path uses git-filter-repo and will rewrite history. Collaborators must be
  coordinated with and shown proof that exposed secrets were rotated prior to running the destructive step.
- This file is an audit record only. It intentionally contains no secrets.
