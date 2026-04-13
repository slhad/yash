Single follow-up recorded: Enable optional artifact signing in CI via repository secret.

Why: We already have scripts to sign artifacts and to verify signatures on consumers. Enabling signing conditionally in CI (when ARTIFACT_SIGNING_KEY secret is present) provides provenance without mandating a key for all runs.

Next steps implemented by this change:
1. CI workflow updated: when secret ARTIFACT_SIGNING_KEY is present, run scripts/ci/sign_artifacts.sh tmp after tar creation.

Local reproduction steps:
- To test locally without a secret: run the hermetic integration flow and confirm sign step is skipped.
- To test signing locally: export ARTIFACT_SIGNING_KEY="$(cat ~/.ssh/id_rsa | sed 's/^/\\n/;s/$/\\n/')" (or use a proper PEM), then run the workflow steps or call scripts/ci/sign_artifacts.sh tmp.

Notes:
- tmp/ is gitignored; this file is intentionally local-only and should not be committed to remote. Keep it for single-follow-up tracking.

---

New Single Follow-up (current): Reproduce hermetic build & run end-to-end locally

Why: Validate the full hermetic CI flow end-to-end so we can verify that the Docker
image exposes bun and Playwright to non-root users, that artifacts are created in
/app/tmp, and that the host-side remediation/manifest/archiving works as intended.

Planned commands (what I'll run now):

- Build image (force):
  FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh

- Run full integration scenario (container_run.sh) and collect artifacts using
  the host wrapper (this will not re-build if the image exists):
  ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/container_run.sh"

- After the container run, attempt remediation + tar + checksums + verification:
  ./scripts/ci/remediate_and_validate_artifacts.sh tmp $(id -u) $(id -g)
  ./scripts/ci/create_artifact_tar.sh tmp
  ./scripts/ci/generate_artifact_checksums.sh tmp
  ./scripts/ci/verify_tarball_against_manifest.sh tmp/integration-artifacts-*.tar.gz tmp/artifact-manifest.json tmp/artifact-checksums.json

Notes / expectations:
- tmp/ is gitignored; artifacts and debug files will live under tmp/ locally.
- If I find a runtime issue (e.g. bun not runnable by non-root users) I'll make a
  minimal fix (prefer small change) and commit that change. tmp/ remains untracked.

I'll now check for Docker availability and attempt the steps above.

---

New Easiest Follow-up (current): Run non-test CI helpers (ShellCheck + image health-check) and record results

Why: Running full tests is time-consuming; a quicker, high-value follow-up is to run non-test CI helpers already present in scripts/ci. This validates the image health-check and produces lint diagnostics without running the test-suite.

Planned commands (no tests):

- Ensure image exists (build if needed):
  FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh

- Run image health-check via the host wrapper (this writes tmp/ci-env.txt):
  ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/image_health_check.sh"

- Run ShellCheck wrapper (non-blocking) and save output to tmp/ci-shellcheck.txt:
  ./scripts/ci/lint_ci_scripts.sh tmp/ci-shellcheck.txt

Notes:
- tmp/ is gitignored; these artifacts are local-only. After running the commands, verify tmp/ contains ci-env.txt and ci-shellcheck.txt.
- If the health-check reveals missing tools (bun, gosu, Playwright path), create a minimal fix and commit it. Otherwise, report back with the diagnostic files.
