Config.json status and recommended followups
=========================================

Summary
-------
- config.json is currently not tracked in the repository index (git status shows it as untracked), and .gitignore already includes `config.json`.
- Because config.json was present in the working directory and contained a plaintext OBS websocket password, it's important to rotate credentials and ensure no sensitive data remains in history.

Recommended immediate steps
---------------------------
1. Rotate the OBS websocket password and any other credentials that were present in config.json.
2. Verify that config.json is not present in any public clones or forks. If it was previously committed to the repository history, consider using git-filter-repo to remove it from history after coordinating with repository owners.
3. Continue using config.example.json as the template and keep config.json local and gitignored.

Notes
-----
- This automation did not find config.json tracked in the index; no `git rm --cached` was required.
- If you want me to remove secrets from history and rewrite commits, tell me — it's destructive and requires coordination.
