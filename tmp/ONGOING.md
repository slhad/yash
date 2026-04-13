Single follow-up recorded: Enable optional artifact signing in CI via repository secret.

Why: We already have scripts to sign artifacts and to verify signatures on consumers. Enabling signing conditionally in CI (when ARTIFACT_SIGNING_KEY secret is present) provides provenance without mandating a key for all runs.

Next steps implemented by this change:
1. CI workflow updated: when secret ARTIFACT_SIGNING_KEY is present, run scripts/ci/sign_artifacts.sh tmp after tar creation.

Local reproduction steps:
- To test locally without a secret: run the hermetic integration flow and confirm sign step is skipped.
- To test signing locally: export ARTIFACT_SIGNING_KEY="$(cat ~/.ssh/id_rsa | sed 's/^/\\n/;s/$/\\n/')" (or use a proper PEM), then run the workflow steps or call scripts/ci/sign_artifacts.sh tmp.

Notes:
- tmp/ is gitignored; this file is intentionally local-only and should not be committed to remote. Keep it for single-follow-up tracking.
