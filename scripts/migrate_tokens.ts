#!/usr/bin/env bun
import { AuthService } from '../src/services/auth.service';
import { defaultLogger } from '../src/utils/logger';

async function main() {
  const auth = new AuthService();
  try {
    await auth.waitForReady(5000);
  } catch (err) {
    // proceed regardless
  }

  const migrated = await auth.migrateTokensToKeyring();
  if (migrated) {
    defaultLogger.info('Migration complete');
    process.exit(0);
  } else {
    defaultLogger.info('No migration performed');
    process.exit(0);
  }
}

main().catch((err) => {
  defaultLogger.error('Migration failed', err);
  process.exit(1);
});
