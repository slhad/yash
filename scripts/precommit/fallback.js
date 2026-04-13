// Lightweight fallback scanner for staged files. Looks for high-confidence secrets
// patterns (private keys, AWS access keys, basic tokens). This is a best-effort
// heuristic and not a replacement for a proper secret scanner.

const { execSync } = require('node:child_process');
const fs = require('node:fs');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (e) {
    return [];
  }
}

const patterns = [
  /-----BEGIN PRIVATE KEY-----/i,
  /-----BEGIN RSA PRIVATE KEY-----/i,
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{40}/i,
  /-----BEGIN OPENSSH PRIVATE KEY-----/i,
  /api_key\s*[:=]\s*[A-Za-z0-9\-_.]{20,}/i,
];

let failed = false;
for (const file of getStagedFiles()) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const p of patterns) {
      if (p.test(content)) {
        console.error(`Potential secret found in staged file: ${file} (pattern: ${p})`);
        failed = true;
      }
    }
  } catch (e) {
    // ignore binary files or deleted files
  }
}

if (failed) {
  console.error('Pre-commit fallback secret scanner detected potential secrets. Aborting commit.');
  process.exit(1);
}

process.exit(0);
