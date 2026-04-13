// Lightweight staged-files scanner to flag likely secrets if gitleaks is not installed.
// Scans staged files for typical secret-looking patterns (long hex strings, AWS keys, private keys).
const { execSync } = require('child_process');
const fs = require('fs');

function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function scanFile(path) {
  try {
    const data = fs.readFileSync(path, 'utf8');
    const patterns = [
      /aws_access_key_id\s*=\s*[A-Z0-9]{16}/i,
      /aws_secret_access_key\s*=\s*[A-Za-z0-9\/+=]{40}/i,
      /-----BEGIN PRIVATE KEY-----/,
      /-----BEGIN RSA PRIVATE KEY-----/,
      /[0-9a-fA-F]{32,}/, // long hex blobs
      /ghp_[A-Za-z0-9_]{36}/, // GitHub token pattern
    ];
    for (const p of patterns) {
      if (p.test(data)) return { path, pattern: p.toString() };
    }
    return null;
  } catch (e) {
    return null;
  }
}

const staged = getStagedFiles();
const findings = [];
for (const f of staged) {
  const r = scanFile(f);
  if (r) findings.push(r);
}

if (findings.length > 0) {
  console.error('Pre-commit fallback scanner detected potential secrets:');
  for (const f of findings) console.error(`  ${f.path} -> ${f.pattern}`);
  process.exit(2);
}

process.exit(0);
