
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
