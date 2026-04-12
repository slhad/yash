Purge Simulation Plan (non-destructive)

Summary
-------
Plan to perform a local simulation of the destructive git-filter-repo purge inside a temporary clone
(`repo-sim`). The simulation rewrites history locally only and produces a report of replacements so
you can verify the impact before coordinating a real purge.

Steps to run (manual or I can run locally if you authorize):

1. Ensure you have `git-filter-repo` installed on your machine.
2. Ensure `tmp/replacements-curated.txt` exists and contains the literal replacements you want to apply.
3. Create a mirror clone and a writable clone:
   - `git clone --mirror <origin> repo-mirror`
   - `git clone repo-mirror repo-sim`
4. Run the rewrite in repo-sim:
   - `cd repo-sim`
   - `git filter-repo --replace-text ../tmp/replacements-curated.txt`
5. Search repo-sim for remaining occurrences of candidate values to confirm replacements.
6. Produce `tmp/purge-simulation-report.txt` summarizing the replaced keys and any residual occurrences.

This procedure rewrites history only in the local clone and does not push changes to the remote.
It is a safe way to preview the effects of the purge operation.
