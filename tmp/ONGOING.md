
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

Easiest/new follow-up (hardness escalated slightly):

Add a lightweight image health-check script inside the repo to run quickly
inside the hermetic image without executing tests. The check verifies bun, node,
npx, gosu, Playwright browser path, and /app/tmp writability. It exits non-zero
if essential pieces are missing.

Steps:
1. Make the health-check executable:
   chmod +x scripts/ci/image_health_check.sh
2. Build the image and run the health check as the non-root user:
   docker build --build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g) -t yash-ci:local .
   docker run --rm --user $(id -u):$(id -g) -v $(pwd)/tmp:/app/tmp yash-ci:local /bin/bash -lc 'bash scripts/ci/image_health_check.sh'
3. Inspect the exit code and tmp/ for ci-env.txt or other artifacts.

This follow-up is fairly low risk and excludes running the tests while catching
environment/path/tooling issues early.

CI Integration (fast health-check):

Add a CI job step that runs the image health-check before executing long-running
tests. The health-check runs as the non-root runner user and fails fast if
critical tools or paths are missing. The host wrapper will collect artifacts
into tmp/ so ci-env.txt and health-check outputs are available for inspection.

The CI step added: run_and_collect_artifacts.sh yash-ci:latest -- "bash scripts/ci/image_health_check.sh"

This is recorded here to document the single-follow-up that was implemented.

New follow-up (hard): Produce a machine-readable artifact manifest on the host
after artifacts are collected. This helps downstream consumers verify file
ownership, size, and modification times and is useful for post-run validation.

Implementation in repo:
- scripts/ci/generate_artifact_manifest.sh — generates tmp/artifact-manifest.json

Steps to use locally (host-only):
1. After running the wrapper and collecting artifacts into tmp/, run:
   ./scripts/ci/generate_artifact_manifest.sh tmp
2. Inspect tmp/artifact-manifest.json for entries with uid/gid and file metadata.

This file is recorded in tmp/ONGOING.md as the single-follow-up; it is local-only.

Follow-up: Validate artifact manifest in CI

We added scripts/ci/validate_artifact_manifest.sh which reads the generated
tmp/artifact-manifest.json and checks that all files are owned by the expected
runner UID:GID. The CI workflow runs this after uploading artifacts and will
write tmp/artifact-ownership-report.txt when mismatches are present.

Local use:
1. After running the wrapper and collecting artifacts, run:
   ./scripts/ci/generate_artifact_manifest.sh tmp
   ./scripts/ci/validate_artifact_manifest.sh tmp/artifact-manifest.json $(id -u) $(id -g)

New follow-up (hardest): Remediate artifact ownership automatically and revalidate

Add a host-side orchestrator that will generate the manifest, validate ownership,
attempt remediation using the fixer script if validation fails, and re-validate.

Script added: scripts/ci/remediate_and_validate_artifacts.sh

Local steps:
1. After running the wrapper, run:
   ./scripts/ci/remediate_and_validate_artifacts.sh tmp $(id -u) $(id -g)
2. Check tmp/artifact-ownership-report.txt for details if remediation fails.

Additional follow-up (hard): Create a timestamped tarball of the collected
artifacts that preserves numeric ownership metadata. This tarball can be
uploaded as a single artifact and inspected by downstream consumers.

Script added: scripts/ci/create_artifact_tar.sh

Local use:
1. After remediation & validation: ./scripts/ci/create_artifact_tar.sh tmp
2. The tarball will appear as tmp/integration-artifacts-<timestamp>.tar.gz



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
