Reproduce hermetic image locally and verify artifact ownership

Single follow-up: Reproduce the hermetic build and run locally, ensuring
that scripts/ci/verify_artifact.sh writes tmp/ci-artifact.txt and
tmp/ci-artifact-owner.txt with ownership matching the host UID:GID.

Steps:
1. Ensure helper is executable: chmod +x scripts/ci/run_hermetic_local.sh
2. Run with build args to bake host UID/GID and force rebuild:
   FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh
3. After completion: ls -la tmp && cat tmp/ci-artifact.txt && cat tmp/ci-artifact-owner.txt

Note: tmp/ is gitignored; this file is intentionally local-only to serve as
the single-follow-up journal for the current iteration.
