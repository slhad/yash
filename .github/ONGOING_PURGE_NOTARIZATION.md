Purge Notarization & Evidence (tracked)

Purpose:
- This file documents the notarization and evidence generation process for purge simulation and execution. It ensures cryptographic artifacts are produced and stored in tmp/evidence/ for audit.

Process:
1) After mirror creation and simulation, run:
   - sh scripts/generate-purge-evidence.sh --mirror-dir tmp/repo-mirror.git --sim-dir tmp/repo-sim/.git
2) Review artifacts in tmp/evidence/: commit-manifest.pre-sim.txt, commit-manifest.post-sim.txt, tree-manifest.*.txt, mirror-backup.sha256, and optional GPG signatures.
3) Include a summary of these artifacts in tmp/purge-simulation-report.txt and link to them from .github/ONGOING_PURGE_VERIFICATION.md and .github/ONGOING_PURGE_CANARY_ORCHESTRATION.md.

Security note:
- Evidence must not contain plaintext secrets. If an artifact reveals sensitive data, remove it immediately and re-run generation after cleaning artifacts.
