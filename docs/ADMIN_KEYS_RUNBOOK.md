Admin Keys: Export / Import / Rotation Runbook
===========================================

Purpose
-------
This runbook documents the operational steps and safety controls for exporting,
importing, and rotating admin keys in YASH. It assumes the codebase uses the
AdminService APIs implemented in src/services/admin.service.ts and the
importKeysHandler HTTP handler (src/handlers/adminKeysHandlers.ts).

Security model (high level)
---------------------------
- Admin tokens are only shown once at creation. The system persists HMAC(token)
  instead of plaintext tokens.
- Exports are hybrid-encrypted packages (RSA-OAEP-SHA256 for AES key +
  AES-256-GCM for payload). Treat export packages and private keys as secrets.
- Imports must preserve HMAC metadata so tokens minted on another instance remain
  verifiable here (incoming HMAC keys are merged into prevHmacKeys).
- Destructive imports (overwrite=true) require explicit strong confirmation via
  ADMIN_TOKEN (admin-token method) and create a pre-import snapshot when possible.

Exporting admin keys (backup / transfer)
---------------------------------------
1. Generate or obtain a RSA public key (PEM format) for the destination
   instance operator. Keep the corresponding private key secret.
2. Call AdminService.exportEncryptedAdminKeys(publicKeyPem). Example:

```js
const svc = new AdminService();
await svc.init();
const pkg = await svc.exportEncryptedAdminKeys(publicKeyPem);
// pkg: { algorithm, encryptedKey, iv, tag, ciphertext }
```

3. Deliver the package to the operator over an authenticated, confidential
   channel. The package contains base64 fields; store them securely (do not
   commit to VCS or expose in logs).

Importing admin keys (preview -> execute)
-----------------------------------------
Use the import API or call AdminService.importEncryptedAdminKeys directly.

Preview (dry-run)

1. Always perform a dry-run first to see what will be added/replaced and which
   HMAC keys would be merged:

```js
const svc = new AdminService();
await svc.init();
const preview = await svc.importEncryptedAdminKeys(privateKeyPem, pkg, { dryRun: true });
// preview.preview -> { toAdd, toReplace }
// preview.mergedHmacsAdded -> list of incoming HMAC keys to be merged
```

2. Inspect preview.preview.toAdd and preview.preview.toReplace to ensure the
   operation matches expectations. If the import contains ids that already
   exist in the destination, they will be skipped unless overwrite=true.

Actual import (non-destructive)

1. To import without replacing existing ids, call:

```js
const result = await svc.importEncryptedAdminKeys(privateKeyPem, pkg, { overwrite: false });
```

2. The method returns { imported, skipped, errors, preview, mergedHmacsAdded }.

Destructive import (overwrite)

1. Overwrite replaces matching keys by id. The HTTP handler protects this
   action: overwrite requires an ADMIN_TOKEN (admin-token method) to confirm
   destructive imports.
2. When overwrite=true and not dryRun, the handler will attempt to create a
   pre-import snapshot file at: ${YASH_DATA_DIR}/import-snapshots/admin_keys_snapshot_<ts>.json
   (best-effort; non-fatal if snapshot fails).

HMAC metadata and token verification
-----------------------------------
- The exported package includes hmacKeys metadata: { current, previous }.
- importEncryptedAdminKeys merges incoming HMAC keys into prevHmacKeys so
  tokens minted on the source instance remain verifiable here.
- verifyToken checks candidates [currentHmac, ...prevHmacKeys]. If a token
  matches an older HMAC, the stored hash for that key is migrated to the
  current HMAC key lazily on first verification.

HMAC rotation
-------------
Use AdminService.rotateHmacKey(newKey?) to rotate the active HMAC key. The
previous key is pushed into prevHmacKeys for backward compatibility. Rotation
is safe because verifyToken will try previous keys and migrate stored hashes
when a token is verified.

Vault and persistence
---------------------
- AdminService attempts a best-effort integration with HashiCorp Vault KV v2
  (if VAULT_ADDR and VAULT_TOKEN are set). When Vault read succeeds the
  in-memory store is seeded from Vault; on save the service attempts to write
  to Vault as well (non-fatal on failure).
- By default AdminService persists to ${YASH_DATA_DIR}/admin_keys.json. The
  data dir is computed at runtime from process.env.YASH_DATA_DIR (or
  $HOME/.yash). Tests and operators should set YASH_DATA_DIR to use alternate
  stores.

Audit
-----
- The import handler appends a non-secret audit entry describing counts of
  imported vs skipped keys, whether the operation was a dry-run, and the
  snapshot path when applicable. Audit entries never include secrets.

Testing guidance
----------------
- Tests should set process.env.YASH_DATA_DIR to an isolated tmp directory and
  instantiate a fresh AdminService instance (do not rely on global state).
- Use the dryRun flow to assert preview lists without writing artifacts.

Operational checklist (quick)
----------------------------
1. Obtain destination public key (PEM).
2. Run exportEncryptedAdminKeys(publicKeyPem) on source instance.
3. Run importEncryptedAdminKeys(privateKeyPem, pkg, { dryRun: true }) on target
   instance and review preview.
4. If satisfied, run real import (overwrite as needed) using ADMIN_TOKEN for
   destructive operations.
5. If overwrite is used, verify pre-import snapshot exists at import-snapshots
   and verify audit log entry.

Security notes
--------------
- Never commit exported packages or private keys to version control.
- Treat persisted admin_keys.json and import snapshots as sensitive assets and
  restrict filesystem permissions (the code attempts 0o600 on persisted files).
- Consider rotating HMAC keys periodically and re-issuing admin tokens if you
  have operational needs to invalidate existing tokens quickly.

Contact
-------
If you need help reproducing imports in a test environment, or migrating keys
between instances using Vault, open an issue or ping the repository maintainers
with the exported package and destination public key (do not send private keys).
