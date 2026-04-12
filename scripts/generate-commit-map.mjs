#!/usr/bin/env node
// Generate a best-effort commit map between pre-sim and post-sim manifests
// Usage: node scripts/generate-commit-map.mjs --pre tmp/evidence/commit-manifest.pre-sim.txt --post tmp/evidence/commit-manifest.post-sim.txt

import fs from 'fs';
import path from 'path';

function readManifest(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      const [sha, ...rest] = line.split(' ');
      const restStr = rest.join(' ');
      // Naive parse: author can include spaces; assume ISO date present; keep entire rest as subject
      return { sha, raw: line, rest: restStr };
    });
}

const args = process.argv.slice(2);
const preIdx = args.indexOf('--pre');
const postIdx = args.indexOf('--post');
if (preIdx === -1 || postIdx === -1) {
  console.error(
    'Usage: node scripts/generate-commit-map.mjs --pre <pre-manifest> --post <post-manifest>',
  );
  process.exit(2);
}
const preFile = args[preIdx + 1];
const postFile = args[postIdx + 1];
const pre = readManifest(preFile);
const post = readManifest(postFile);

const out = [];
const used = new Set();

for (const p of pre) {
  // try exact raw match
  let match = post.find((q) => q.raw === p.raw);
  let method = 'exact';
  if (!match) {
    match = post.find((q) => q.raw.includes(p.raw.split(' ').slice(1, 4).join(' ')));
    method = 'heuristic';
  }
  if (match) {
    used.add(match.sha);
    out.push(`${p.sha} ${match.sha} 1.0 ${method}`);
  } else {
    out.push(`${p.sha} - 0.0 none`);
  }
}

fs.writeFileSync('tmp/commit-map.txt', out.join('\n') + '\n');
fs.writeFileSync(
  'tmp/commit-map.report.txt',
  `mapped=${out.filter((x) => !x.includes(' - ')).length} total=${out.length}\n`,
);
console.log('Wrote tmp/commit-map.txt and tmp/commit-map.report.txt');
