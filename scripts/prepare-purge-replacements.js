#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run() {
  console.log('Preparing replacements for git-filter-repo (output -> tmp/replacements.txt)');

  let filesRaw = '';
  try {
    filesRaw = execSync('git ls-files', { encoding: 'utf8' });
  } catch (err) {
    console.error('Failed to list git files. Are you in a git repo?');
    process.exit(1);
  }

  const files = filesRaw
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => {
      if (
        f.startsWith('node_modules/') ||
        f.startsWith('dist/') ||
        f.startsWith('tmp/') ||
        f.startsWith('.git/')
      )
        return false;
      // skip binary-ish files
      const ext = path.extname(f).toLowerCase();
      const allow = [
        '.json',
        '.env',
        '.yml',
        '.yaml',
        '.js',
        '.ts',
        '.tsx',
        '.jsx',
        '.md',
        '.txt',
        '.conf',
        '.ini',
      ];
      return allow.includes(ext) || f === 'config.json';
    });

  const secretPattern =
    /["']?(password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret|streamKey)["']?\s*[:=]\s*["']?([^"'\n,}]+)["']?/gi;

  const found = new Set();
  const locations = [];

  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      let m;
      while ((m = secretPattern.exec(content)) !== null) {
        const key = m[1];
        const value = m[2];
        if (!value) continue;
        found.add(value);
        // record location without printing the value (safe summary)
        const before = Math.max(0, m.index - 40);
        const snippet = content
          .substring(before, Math.min(content.length, m.index + 80))
          .replace(/\r?\n/g, ' ');
        locations.push({ file: f, key, snippet });
      }
    } catch (err) {
      // ignore unreadable files
    }
  }

  if (!fs.existsSync('tmp')) fs.mkdirSync('tmp');

  const replacementsPath = path.join('tmp', 'replacements.txt');
  const locationsPath = path.join('tmp', 'secret-locations.txt');

  const replacementsStream = fs.createWriteStream(replacementsPath, {
    flags: 'w',
    encoding: 'utf8',
  });
  for (const v of found) {
    // Write raw secret value -> replacement line (git-filter-repo uses exact match)
    replacementsStream.write(`${v}==>***REDACTED***\n`);
  }
  replacementsStream.end();

  const locationsStream = fs.createWriteStream(locationsPath, { flags: 'w', encoding: 'utf8' });
  locationsStream.write('# Likely secret locations (values redacted from this summary)\n');
  for (const loc of locations) {
    locationsStream.write(`${loc.file}: key=${loc.key} snippet=${loc.snippet}\n`);
  }
  locationsStream.end();

  console.log(`Wrote ${found.size} unique candidate secrets to ${replacementsPath} (untracked).`);
  console.log(`Wrote locations summary to ${locationsPath} (untracked).`);
  console.log('Inspect tmp/replacements.txt before running scripts/purge-secrets.sh');
}

if (require.main === module) run();
