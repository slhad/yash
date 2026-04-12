Purge Readiness Checklist Added

Summary
-------
Added scripts/prepare-purge-checklist.sh — a non-destructive readiness checklist that verifies:

- A non-empty replacements file exists (prefers tmp/replacements-curated.txt)
- The working tree is clean
- The remote origin is configured
- git-filter-repo is available (warning if missing)
- CONFIRM_PURGE environment variable presence is noted

This script does NOT execute the purge; it only reports readiness and prints the exact destructive
command to run when you are ready.

How to use
----------
1. Ensure tmp/replacements-curated.txt exists (run the curator script if needed).
2. Run the checklist: `sh scripts/prepare-purge-checklist.sh`.

If the checklist passes, rotate any exposed credentials and coordinate with collaborators before running
the purge command shown at the end of the checklist output.
