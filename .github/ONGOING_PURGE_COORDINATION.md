Purge Coordination & Rotation Plan

Purpose
-------
Provide an operational plan to rotate exposed credentials, coordinate a destructive history purge
using git-filter-repo, and manage collaborator communication and verification. This document is
an audit record and does NOT contain any secret values.

Scope
-----
- Targets the candidate secret list in tmp/replacements-curated.txt (final curated list).
- Does NOT include actual secret values. Only references to files/artifacts and evidence are recorded.

Prerequisites
-------------
1. Finalized replacements file: tmp/replacements-curated.txt (reviewed and confirmed).
2. Evidence that every credential listed has been rotated (see "Rotation Evidence").
3. Backups created: mirror clone of the repository and a writable clone for simulation.
4. All core maintainers agree on a purge window and accept the impact (force-push will break local clones).

High-Level Steps
----------------
1) Assemble rotation owners
   - For each secret category (OBS, YouTube/Twitch/Kick stream keys, OAuth clients, CI secrets), assign an owner responsible
     for rotation and evidence collection.

2) Finalize curated replacements
   - Run: `bun run scripts/curate-replacements.mjs`
   - Inspect tmp/replacements-curated.txt and remove false positives.

3) Rotate credentials (per-owner)
   - Each owner rotates secrets in the external service (platform console, OBS, CI provider) and records evidence.
   - Evidence file: tmp/rotation-evidence.txt (one line per rotated secret):
     - `<who> | <platform/service> | <artifact-path-or-link> | <rotation-timestamp> | <notes>`
   - Do NOT include secret values in the evidence file; include proof such as "rotated via console; screenshot saved to tmp/evidence/obs-rotate.png".

4) Verify rotation
   - Owners confirm that old credentials are revoked and new credentials work in staging where applicable.
   - Update tmp/rotation-evidence.txt with verification entries.

5) Run curator + checklist
   - `bun run scripts/curate-replacements.mjs`
   - `sh scripts/prepare-purge-checklist.sh` — fix any reported issues (clean working tree, remote configured, replacements file present).

6) Simulation (local, non-pushing)
   - Follow .github/ONGOING_PURGE_SIMULATION.md steps (repo-sim) to run git-filter-repo locally using the curated replacements file.
   - Produce tmp/purge-simulation-report.txt summarizing what changed and any residual occurrences.

7) Review simulation & get sign-off
   - Share the simulation report with maintainers and request formal approval (e.g., a comment on a dedicated issue or a signed-off PR).
   - Require at least two maintainer approvals before proceeding with destructive execution.

8) Execute destructive purge (ONLY AFTER ROTATION & SIGN-OFF)
   - Ensure backups exist: `git clone --mirror <origin> repo-mirror`
   - Run (on a machine with git-filter-repo):
     - `CONFIRM_PURGE=1 sh scripts/purge-secrets.sh --secrets-file tmp/replacements-curated.txt --execute`
   - This will create a rewritten mirror and force-push it to the remote (per script behavior).

9) Post-purge operations
   - Notify all collaborators (see templates below) and require them to re-clone the repository.
   - Run CI and gitleaks on the rewritten remote to confirm no residual secrets remain.
   - Rotate any remaining credentials if required.
   - Remove or secure backup files after an agreed retention period.

Rotation Evidence Guidelines
---------------------------
- Evidence MUST not include secret values.
- Use brief descriptions and point to artifacts saved under tmp/evidence/ (screenshots, logs showing success, timestamps).
- Each evidence line: `<owner> | <service> | <artifact-path> | <timestamp> | <notes>`

Approval Gate
-------------
- Require explicit sign-off from at least two repository maintainers in the issue tracking the purge.
- Use a dedicated issue or PR to collect sign-offs and link the simulation report and rotation evidence.

Communication Templates
-----------------------
1) PR template to rotate secrets (example body — DO NOT INCLUDE SECRETS)

Title: chore(secrets): rotate exposed credentials (pre-purge)

Body:
```
Summary: Rotate credentials referenced in tmp/replacements-curated.txt prior to history purge.

Owners and responsibilities:
- @owner1: OBS websocket password
- @owner2: YouTube stream keys

Evidence: see tmp/rotation-evidence.txt and tmp/evidence/*

Testing: Confirmed in staging (details in evidence)

Requesting approval from: @maintainerA, @maintainerB
```

2) Collaborator notification message (email/Slack)

```
Subject: Repository history rewrite scheduled — re-clone required

Hi team,

We will run a repository history rewrite to purge exposed secrets on DATE at TIME (UTC).
After the rewrite, your local clones will be incompatible. Please re-clone the repository after we announce completion.

Steps we'll perform:
1) Backup mirror clone
2) Rewrite history with git-filter-repo
3) Force-push rewritten history
4) Run CI and validate

After we complete the purge, we'll announce here with the commands to re-clone.

If you have unmerged local work, please push it to a temporary branch or save patches before the window.

Regards,
Repo Maintainers
```

Recovery / Rollback Plan
------------------------
- If something goes wrong, restore from the mirror backup: keep the mirror for a retention period (e.g., 7 days).
- Provide a step-by-step rollback in the issue tracking the purge.

Record After Execution
----------------------
Create a tracked audit file .github/ONGOING_PURGE_EXECUTED.md capturing:
- Date/time of purge
- Number of replacements applied
- List of rotated credentials (owners & evidence paths)
- Link to simulation report and rotation evidence
- Summary of post-purge verification steps and results

Important
---------
- DO NOT include secret values in any committed files or audit records.
- The destructive purge is irreversible for existing clones; collaborators must re-clone.
