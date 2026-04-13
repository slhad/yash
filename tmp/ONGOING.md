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

---

New Hardest Follow-up (current): Enable end-to-end artifact signing and verification in CI

Why: We already have scripts to sign artifacts (scripts/ci/sign_artifacts.sh) and to
verify them (scripts/ci/verify_signatures_and_restore.sh). The CI workflow now has a
conditional signing step that runs when the secret ARTIFACT_SIGNING_KEY is present.
To complete end-to-end signing we should add the repository secret, run a CI job that
executes signing and verification steps, and validate the artifacts produced.

Concrete tasks:
1. Add an RSA private key PEM to the repository Actions secrets named ARTIFACT_SIGNING_KEY.
   - Use a dedicated key pair for CI signing; do not reuse personal SSH keys.
   - The secret value should be the full PEM private key text.
2. Trigger CI on a branch (protected or test branch) so the signing steps run in a controlled setting.
3. Confirm CI produced:
   - tmp/integration-artifacts-<ts>.tar.gz and its .sig/.sig.asc files
   - tmp/artifact-signing-public.pem
   - tmp/artifact-manifest.json and tmp/artifact-checksums.json plus their signatures
4. If verification fails in CI, collect diagnostics (ci-env.txt, artifact-ownership-report.txt) and iterate on signing/verify scripts.
5. Add README/CI.md documenting how to add/rotate the ARTIFACT_SIGNING_KEY secret and how to verify artifacts using scripts/ci/verify_signatures_and_restore.sh.

Local test steps (without committing secrets):
- Generate a temporary RSA key pair and export ARTIFACT_SIGNING_KEY in your shell.
- Run the signing script locally: scripts/ci/sign_artifacts.sh tmp
- Verify signatures locally: scripts/ci/verify_signatures_and_restore.sh tmp/integration-artifacts-*.tar.gz --pubkey tmp/artifact-signing-public.pem --no-ownership

Notes:
- tmp/ is gitignored and remains local-only. The secret must be added through the repository's Actions secrets UI by a user with admin access.
- This is a high-trust operation: keep keys secure and rotate them periodically.

---

New Hardest Follow-up (this iteration): Document and finalize canonical artifact ownership decision

Why: Ensure the team has an authoritative, documented reference explaining why we chose the runtime --user + host-side remediation approach, how it works, and how to opt into the alternate bake-user approach when strictly required.

Planned tasks I completed in this iteration:
- Added docs/CI_ARTIFACT_OWNERSHIP.md detailing the decision, rationale, implementation summary, and reproduction commands.
- Added CI workflow signing+verification steps (conditional on ARTIFACT_SIGNING_KEY) and non-blocking ShellCheck upload (previous step).

Next actions for reviewers:
1. Read docs/CI_ARTIFACT_OWNERSHIP.md and confirm this decision with the team.
2. If accepted, close this follow-up. If you prefer the bake-user model, tell me and I will implement the alternate CI path.

---

New Hardest Follow-up (alternate): Add a bake-user CI path and toggle

Why: While runtime --user is the recommended default, some teams may prefer to bake
the host user into the image to avoid host-side remediation. Implementing a second,
explicit CI path (bake-user) makes the choice discoverable and reversible.

Concrete tasks to implement bake-user path:
1. Add a new workflow job or a condition in integration-hermetic that can be toggled
   using an input or repository variable (e.g. USE_BAKE_USER=true). When enabled,
   CI will build the image with --build-arg HOST_UID and HOST_GID and run the container
   without --user; the baked hostuser will be used inside the container.
2. Ensure ci-entrypoint.sh will prefer the baked hostuser if present and gracefully
   fall back to runtime --user behavior. (ci-entrypoint already creates hostuser when
   HOST_UID/HOST_GID are provided; baking at build-time plus running without --user
   achieves the same ownership results.)
3. Add gating docs and a short 'how-to' to docs/CI_ARTIFACT_OWNERSHIP.md describing
   the tradeoffs and how to enable bake-user runs.

If you want me to implement the bake-user CI path now, say so and I'll add a
conditional job/flag in .github/workflows/ci.yml and the minimal wrapper changes.

---

New Hardest Follow-up (this iteration): Add a discoverable bake-user CI path and workflow_dispatch toggle

Why: Some teams prefer to bake the host user into the image and run containers
without --user to avoid host-side remediation. Making this path explicit and
toggleable from the Actions UI reduces friction and keeps the default runtime
--user behavior unchanged.

What I changed in this iteration:
1. scripts/ci/run_and_collect_artifacts.sh now respects BAKE_USER=true and will
   run the container without --user when set.
2. .github/workflows/ci.yml gained a workflow_dispatch input `bake_user` so
   repository operators can trigger the bake-user path manually.

How to test locally:

  # Build image with baked host UID/GID
  BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" docker build $BUILD_ARGS -t yash-ci:local .
  # Run the wrapper in bake-user mode
  BAKE_USER=true ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/container_run.sh"

To trigger from Actions UI: run the CI workflow via "Run workflow" and set
the input `bake_user` to `true`.

Notes:
- Default CI behavior is unchanged (runtime --user). The bake-user path is
  intentionally opt-in via the workflow_dispatch input or local BAKE_USER env var.
- tmp/ remains gitignored; this file documents the manual steps for local testing.
---

New Single Follow-up (this iteration): Create a full local run wrapper and documented next steps

Why: Running each script manually is error-prone. Adding a deterministic wrapper
that performs build -> run -> collect -> remediate -> tar -> checksum -> verify -> sign
reduces manual steps for developers and makes local reproduction trivial.

What I added in this iteration:
1. scripts/ci/run_full_local_ci.sh — wrapper that runs the full pipeline locally.
   - Supports flags: --force-build, --no-sign, --generate-key, --image.
   - Writes artifacts and diagnostics under tmp/ (gitignored)
2. scripts/ci/generate_signing_key.sh — helper to create a temporary RSA pair for local testing.
3. docs/CI_SIGNING.md — documentation for enabling signing in CI and local verification.

Local run example (recommended):

  # Build image, run full pipeline, generate temporary signing key and sign artifacts
  ./scripts/ci/run_full_local_ci.sh --force-build --generate-key

Or to skip signing:

  ./scripts/ci/run_full_local_ci.sh --force-build --no-sign

Notes:
- tmp/ remains gitignored; keep troubleshooting artifacts there.
- If you want this wrapper invoked by CI for smoke/local debugging runs, I can add
  a small job or an action input to call it from workflows/ci.yml (prefer to keep
  CI steps explicit for transparency).

Next steps for reviewers:
1. Run ./scripts/ci/run_full_local_ci.sh --generate-key and inspect tmp/ for
   manifest, tarball, signatures, and verification reports.
2. If you prefer, request I wire an optional CI job that executes the same wrapper
   on demand (e.g., with a workflow_dispatch input).
