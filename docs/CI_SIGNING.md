Artifact Signing and Verification in CI
=====================================

Purpose
-------
Describe how CI artifact signing/verification works, how to enable it, and
how to test locally. This complements the signer and verifier helpers in
scripts/ci and documents the operational steps for adding and rotating keys.

What the pipeline does
----------------------
- When the repository secret ARTIFACT_SIGNING_KEY (PEM private key text) is
  present, the CI job will run scripts/ci/sign_artifacts.sh after creating the
  artifact tarball. The public key is exported into tmp/artifact-signing-public.pem
  and detached signatures (.sig and .sig.asc) are written next to artifacts.
- Consumers can verify signatures using scripts/ci/verify_signatures_and_restore.sh
  (it supports providing --pubkey or will look for artifact-signing-public.pem
  co-located with the tarball).

How to enable signing in CI
---------------------------
1. Generate a dedicated RSA keypair for CI signing. You can generate one locally
   using the helper or openssl directly (do not commit the private key):

   # helper (recommended)
   ./scripts/ci/generate_signing_key.sh tmp

   # or using openssl manually
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out tmp/artifact_signing_key.pem
   openssl pkey -in tmp/artifact_signing_key.pem -pubout -out tmp/artifact-signing-public.pem

2. Add the private key PEM text as an Actions repository secret named
   ARTIFACT_SIGNING_KEY. Use the full PEM (including header/footer and newlines).

3. Push a branch and open a PR (or push to a test branch). The existing
   .github/workflows/ci.yml contains a conditional step that will sign artifacts
   when the secret is present. The CI job will write the public key and signatures
   into the job artifact (tmp/).

How to verify artifacts
-----------------------
- To verify signatures locally (without changing ownership), extract the tarball
  and run the verifier in no-ownership mode:

  ./scripts/ci/verify_signatures_and_restore.sh tmp/integration-artifacts-*.tar.gz --pubkey tmp/artifact-signing-public.pem --no-ownership

- The verifier will check the tar signature (if present) and internal signatures
  for artifact-manifest.json and artifact-checksums.json, then optionally extract
  and restore ownership (default behavior).

Local developer workflow
------------------------
1. Generate a temporary keypair and place files under tmp/:
   ./scripts/ci/generate_signing_key.sh tmp

2. Export the private key into your shell for local testing:
   export ARTIFACT_SIGNING_KEY="$(cat tmp/artifact_signing_key.pem)"

3. Run the signing script against the locally-produced artifacts:
   ./scripts/ci/sign_artifacts.sh tmp

4. Verify signatures:
   ./scripts/ci/verify_signatures_and_restore.sh tmp/integration-artifacts-*.tar.gz --pubkey tmp/artifact-signing-public.pem --no-ownership

Security and rotation
---------------------
- Use a dedicated keypair for CI signing. Do not reuse personal keys.
- Store the private key only in the Actions secrets vault; do not commit it.
- To rotate keys: generate a new keypair, update the ARTIFACT_SIGNING_KEY secret,
  and publish the new public key to consumers (or place it in a known location
  referenced by your downstream verification process).

Notes
-----
- The CI workflow will only perform signing when secrets.ARTIFACT_SIGNING_KEY is
  set in the Actions secrets for the repository (see .github/workflows/ci.yml).
- The helper script scripts/ci/generate_signing_key.sh is provided to make local
  testing easier; it writes keys into tmp/ (which is gitignored).
