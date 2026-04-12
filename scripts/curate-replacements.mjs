#!/usr/bin/env node
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

async function walk(dir, excludeDirs) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (
      excludeDirs.some((d) => full.includes(path.sep + d + path.sep) || full.endsWith(path.sep + d))
    ) {
      continue;
    }
    if (e.isDirectory()) {
      files.push(...(await walk(full, excludeDirs)));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isAllowedExtension(f) {
  const ext = path.extname(f).toLowerCase();
  const allow = new Set([
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
    '.html',
    '.tsx',
    '.cjs',
    '.mjs',
    '.css',
    '.map',
  ]);
  return (
    allow.has(ext) ||
    path.basename(f) === 'config.json' ||
    path.basename(f) === 'config.example.json'
  );
}

async function run() {
  const replacementsPath = path.join('tmp', 'replacements.txt');
  if (!fsSync.existsSync(replacementsPath)) {
    console.error(
      'No tmp/replacements.txt found. Run scripts/prepare-purge-replacements.js first.',
    );
    process.exit(1);
  }

  const raw = await fs.readFile(replacementsPath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const values = lines.map((l) => l.split('==>')[0].trim()).filter(Boolean);

  console.log(`Found ${values.length} candidate values in tmp/replacements.txt`);

  // Build file list to search (exclude vendor and binary dirs)
  const excludeDirs = ['.git', 'node_modules', 'dist', 'tmp'];
  const files = await walk(process.cwd(), excludeDirs);
  const textFiles = files.filter(isAllowedExtension);

  const curated = [];
  const ignoredPathPatterns = [/^test\//i, /config.example.json$/i, /^tmp\//i, /\/\.github\//i];

  for (const v of values) {
    if (!v || v.length === 0) continue;
    const matchedFiles = [];
    for (const f of textFiles) {
      try {
        const content = await fs.readFile(f, 'utf8');
        if (content.indexOf(v) !== -1) {
          // normalize to forward slashes for pattern matching
          const rel = path.relative(process.cwd(), f).split(path.sep).join('/');
          matchedFiles.push(rel);
        }
      } catch (err) {
        // ignore unreadable files
      }
    }

    if (matchedFiles.length === 0) {
      // No occurrences found; skip (likely stale)
      continue;
    }

    const allIgnored = matchedFiles.every((mf) => {
      return ignoredPathPatterns.some((pat) => pat.test(mf));
    });

    if (!allIgnored) {
      curated.push({ value: v, files: matchedFiles });
    }
  }

  if (!fsSync.existsSync('tmp')) await fs.mkdir('tmp');
  const outPath = path.join('tmp', 'replacements-curated.txt');
  const linesOut = curated.map((c) => `${c.value}==>***REDACTED***`);
  await fs.writeFile(outPath, linesOut.join('\n'), 'utf8');

  console.log(`Wrote ${curated.length} curated candidates to ${outPath}`);
  for (const c of curated) {
    console.log(`- ${c.value} -> ${c.files.join(', ')}`);
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1].endsWith('/scripts/curate-replacements.mjs')
) {
  run().catch((err) => {
    console.error('Error:', err);
    process.exit(2);
  });
}
