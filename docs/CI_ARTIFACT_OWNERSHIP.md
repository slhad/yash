CI Artifact Ownership: Decision & Implementation
===============================================

Goal
----
Make CI artifact ownership deterministic, reproducible, and easy to triage. Artifacts produced by hermetic containers must be collectable by the host runner with correct ownership and integrity guarantees.

Decision (canonical approach)
-----------------------------
Use the "runtime --user" approach by default: run the hermetic container as the host runner user (docker run --user $(id -u):$(id -g)), and rely on a robust host-side remediation and verification pipeline to ensure artifacts are owned as expected and preserved with provenance (numeric-owner tar + manifest + checksums + optional signing).

Rationale
---------
- Predictable ownership: running the container as the host user means files written to mounted host volumes are already owned by the runner, avoiding privileged operations in the container.
- Least surprising: no need to bake host-specific UIDs into shared images by default, so images remain portable and reusable across runners/users.
- Security: avoids baking arbitrary UIDs/GIDs into published images, and avoids running processes as root in CI container runs.
- Robustness: the host-side remediation pipeline covers edge cases (failed chown, docker cp fallbacks) and produces machine-readable manifests + checksums for validation and forensics.

What we implemented (summary)
-----------------------------
- Dockerfile changes to make runtime tools available to non-root users (copy bun binary to /usr/local/bin, set PLAYWRIGHT_BROWSERS_PATH).
- ci-entrypoint.sh handles dropping privileges and setting PATH/PLAYWRIGHT_BROWSERS_PATH when HOST_UID/HOST_GID are provided.
- run_and_collect_artifacts.sh: host-side wrapper that runs container detached, waits, docker cp fallback via tar, and calls a fixer.
- fix_host_artifact_ownership.sh: host-side fixer that reads tmp/ci-artifact-owner.txt and attempts chown, non-interactive sudo, or docker-based chown fallback.
- generate_artifact_manifest.sh / validate_artifact_manifest.sh: produce and validate file ownership/manifests.
- create_artifact_tar.sh: produce numeric-owner tarball for preservation and consumer extraction.
- sign_artifacts.sh / verify_signatures_and_restore.sh: optional signing and verification flow (CI runs this only when ARTIFACT_SIGNING_KEY secret is present).

How CI uses the approach
------------------------
1. Build the hermetic image (CI may pass build-args HOST_UID/HOST_GID if desired, but the default behavior is NOT to bake host UIDs).
2. Run the container as the runner user and mount a host tmp/ into /app/tmp.
3. The container writes artifacts into /app/tmp.
4. The host wrapper script run_and_collect_artifacts.sh copies /app/tmp back to the host (docker cp or tar fallback) and runs fix_host_artifact_ownership.sh.
5. The remediation script generates a manifest and validates ownership; if mismatches remain remediation fails the step but CI still uploads diagnostics (always()).
6. CI creates numeric-owner tarball and (optionally) signs it.

Commands (local reproduction)
----------------------------
- Build image (force):
  FORCE_BUILD=1 BUILD_ARGS="--build-arg HOST_UID=$(id -u) --build-arg HOST_GID=$(id -g)" ./scripts/ci/run_hermetic_local.sh

- Run health-check (non-tests):
  ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/image_health_check.sh"

- Run full container steps and collect artifacts (careful: runs tests):
  ./scripts/ci/run_and_collect_artifacts.sh yash-ci:local -- "bash scripts/ci/container_run.sh"

- Remediate and validate artifacts on host:
  ./scripts/ci/remediate_and_validate_artifacts.sh tmp $(id -u) $(id -g)

- Create numeric-owner tar and checksums:
  ./scripts/ci/create_artifact_tar.sh tmp
  ./scripts/ci/generate_artifact_checksums.sh tmp

- Optional: Sign artifacts (local test with temporary key):
  export ARTIFACT_SIGNING_KEY="$(sed 's/^/\\n/;s/$/\\n/' /tmp/ci_signing_key.pem)"
  ./scripts/ci/sign_artifacts.sh tmp

If you prefer to bake host user into image (alternate approach)
------------------------------------------------------------
This repository still supports an alternate model: "bake host user into image". Use when you control the runner environment and want artifacts to be written with baked-in UIDs (this can reduce the need for host remediation but has tradeoffs):

- Pros:
  - Artifacts produced by the container have desired numeric owners without host-side chown.
  - Avoids need for host-side chown steps in some environments.
- Cons:
  - Images become host-specific; caching and reuse across different CI runners/users is negatively impacted.
  - Publishing images with baked host UIDs can be confusing and may leak host-specific metadata.

To build an image that bakes a host user into it run on your runner:
  docker build --build-arg HOST_UID="$(id -u)" --build-arg HOST_GID="$(id -g)" -t yash-ci:local .

When to choose which approach
-----------------------------
- Default: runtime --user + host-side remediation. This is the recommended, safest, and most portable default.
- Choose bake-user only if you have strict runner control, and you document the implications for image reuse and publishing.

Next steps / acceptance criteria
--------------------------------
1. Document the decision in repository docs (this file). DONE.
2. Make sure CI workflow comments and steps reference this doc. DONE (workflow updated to run host-side wrapper and remediation).
3. Team to agree on the canonical approach; if the team prefers "bake-user" we should add an explicit CI path and gating before switching.
4. Add a short README/CI.md snippet showing how to rotate signing keys and how consumers verify artifacts (follow-up task).

Contact
-------
If you have questions about this decision or want me to implement the bake-user CI path instead, tell me which to implement and I'll make the minimal code changes and tests.
