#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

async function main() {
  let keytar;
  try {
    const mod = await import('keytar');
    keytar = mod.default ?? mod;
  } catch (err) {
    console.error(
      'keytar module not installed or failed to import. Install with `bun add -d keytar`.',
    );
    process.exit(2);
  }

  if (!keytar || typeof keytar.findCredentials !== 'function') {
    console.error('keytar does not expose findCredentials; cannot verify keyring.');
    process.exit(2);
  }

  try {
    const creds = await keytar.findCredentials('yash.tokens');
    if (!Array.isArray(creds) || creds.length === 0) {
      console.log('No entries found for service "yash.tokens".');
      process.exit(0);
    }

    console.log(`Found ${creds.length} accounts for service 'yash.tokens':`);
    const accounts = creds.map((c) => c.account);
    for (const a of accounts) console.log('-', a);

    // Write a safe accounts list (no secrets) to tmp/
    try {
      if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');
      const out = path.join('tmp', 'keyring-accounts.txt');
      fs.writeFileSync(out, accounts.join('\n'), { encoding: 'utf8' });
      console.log(`Wrote ${out} (contains account names only, no secret values).`);
    } catch (err) {
      console.warn('Failed to write tmp/keyring-accounts.txt:', err);
    }

    process.exit(0);
  } catch (err) {
    console.error('Failed to query keyring:', err);
    process.exit(3);
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1].endsWith('/scripts/verify-keyring.mjs')
) {
  main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(10);
  });
}
