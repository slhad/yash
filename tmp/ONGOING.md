
Hardest follow-up (next): Ensure artifacts produced by the hermetic container
are reliably owned by the host runner and, if not, provide a deterministic
host-side fix that CI can call before uploading artifacts.

Single follow-up: Add and use a small host-side helper that reads
tmp/ci-artifact-owner.txt (written by the container) and chowns the host tmp/
directory to the owned UID:GID so GitHub Actions' upload step will have the
expected file ownership and no permission surprises.

Steps to reproduce and validate locally:
1. Ensure helpers are executable:
   chmod +x scripts/ci/run_hermetic_local.sh scripts/ci/fix_host_artifact_ownership.sh scripts/ci/run_and_collect_artifacts.sh
2. Build+run hermetic locally (force rebuild with host UID/GID baked):
   FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh
3. After the container run exits, run the host-side fixer (this is safe if
   the owner file is missing):
   ./scripts/ci/fix_host_artifact_ownership.sh tmp
4. Alternatively use the new wrapper which runs the container detached and
   reliably collects artifacts with fallbacks:
   ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/verify_artifact.sh"
5. The verification script now writes a CI environment snapshot to
   tmp/ci-env.txt to aid debugging (bun/node/gosu/playwright paths and versions).
4. Update CI workflow to run the fixer before uploading artifacts (done in
   .github/workflows/ci.yml - the step is named "Fix host artifact ownership").
4. Inspect tmp/: ls -la tmp && cat tmp/ci-artifact-owner.txt

Notes:
- This host-side fixer is intended to be run by CI as a deterministic final
  step prior to actions/upload-artifact if docker cp failed to preserve
  ownership or if chown inside the container was not permitted.
- tmp/ is gitignored; this file is intentionally local-only to serve as the
  single-follow-up journal for the current iteration.

Additional verification steps (non-test, lowest-risk):

1. Verify entrypoint environment propagation for non-root runs: build image and run a quick container that prints PATH and PLAYWRIGHT_BROWSERS_PATH without running tests.

   Example:
   docker build --build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g) -t yash-ci:local .
   docker run --rm --user $(id -u):$(id -g) -v $(pwd)/tmp:/app/tmp yash-ci:local /usr/local/bin/ci-entrypoint.sh bash -lc 'echo PATH=$PATH; echo PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH; which bun || true; bun --version 2>/dev/null || true'

2. Inspect tmp/ after the quick run to confirm scripts can execute (no tests run): ls -la tmp && cat tmp/ci-env.txt || true

Record results locally in tmp/ONGOING.md after verification.

Easiest follow-up (exclude running tests):

Make all CI helper scripts executable and perform a quick shell lint locally.
This is low-risk, doesn't run the test-suite, and reduces friction when
reproducing runs locally or in CI.

Steps:
1. Make helper scripts executable locally:
   chmod +x scripts/ci/*.sh
2. (Optional) Lint the scripts using ShellCheck to catch common issues:
   shellcheck scripts/ci/*.sh
   - Install ShellCheck on Ubuntu: sudo apt-get update && sudo apt-get install -y shellcheck
3. Commit permission changes (git will ignore tmp/):
   git add -A
   git commit -m "chore(ci): mark CI helper scripts executable; document easiest follow-up in tmp/ONGOING.md"
4. Do not run tests as per instruction; this follow-up is limited to tooling and script hygiene.

This file is intentionally gitignored; it records a local-only single-follow-up.
