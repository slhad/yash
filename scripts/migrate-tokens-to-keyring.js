#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function getTokensFile() {
  const dataDir = process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
  return path.join(dataDir, 'tokens.json');
}

async function main() {
  const tokensFile = getTokensFile();
  if (!fs.existsSync(tokensFile)) {
    console.error(`No tokens file found at ${tokensFile}. Nothing to migrate.`);
    process.exit(0);
  }

  let keytar;
  try {
    keytar = require('keytar');
  } catch (err) {
    console.error(
      'keytar module not installed. Install it with `bun add -d keytar` or `npm i keytar`',
    );
    process.exit(2);
  }

  if (!keytar || typeof keytar.setPassword !== 'function') {
    console.error('keytar does not appear usable in this environment. Aborting.');
    process.exit(2);
  }

  // Read tokens file
  let content;
  try {
    content = fs.readFileSync(tokensFile, 'utf8');
  } catch (err) {
    console.error('Failed to read tokens file:', err);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error('Failed to parse tokens.json as JSON:', err);
    process.exit(4);
  }

  const platforms = Object.keys(parsed);
  if (platforms.length === 0) {
    console.log('No platform tokens found in tokens.json. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`Found ${platforms.length} platforms in tokens.json: ${platforms.join(', ')}`);

  for (const platform of platforms) {
    const encrypted = parsed[platform];
    // Basic validation
    if (!encrypted || typeof encrypted.iv !== 'string' || typeof encrypted.data !== 'string') {
      console.warn(`Skipping ${platform}: not a valid encrypted token shape`);
      continue;
    }
    try {
      await keytar.setPassword('yash.tokens', platform, JSON.stringify(encrypted));
      console.log(`Migrated token for ${platform} into OS keyring under service 'yash.tokens'`);
    } catch (err) {
      console.error(`Failed to store token for ${platform} into keyring:`, err);
    }
  }

  // Backup original file
  try {
    const bak = `${tokensFile}.bak.${Date.now()}`;
    fs.renameSync(tokensFile, bak);
    console.log(`Renamed original tokens.json to ${bak}`);
  } catch (err) {
    console.error('Failed to rename original tokens.json. Manual cleanup required:', err);
    process.exit(5);
  }

  console.log(
    'Migration complete. Verify keyring entries (e.g., using a keytar client) and then remove backups as appropriate.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error during migration:', err);
    process.exit(10);
  });
}
