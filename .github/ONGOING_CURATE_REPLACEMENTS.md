Curate Replacements Script Added

Summary
-------
Added scripts/curate-replacements.mjs to programmatically filter the candidate secrets
found in tmp/replacements.txt and produce tmp/replacements-curated.txt containing only
values that appear outside of known test/example paths. This reduces false positives and
helps prepare a safe replacements file for git-filter-repo.

Usage
-----
1. Run the prepare step first: `bun scripts/prepare-purge-replacements.js` (creates tmp/replacements.txt).
2. Run the curator: `bun run scripts/curate-replacements.mjs` which writes tmp/replacements-curated.txt.

Next steps
----------
1. Inspect tmp/replacements-curated.txt and rotate any exposed credentials before executing purge.
2. When satisfied, use the curated file as input for scripts/purge-secrets.sh.
