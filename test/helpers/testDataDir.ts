import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

function getTestTmpRoot(): string {
  return path.join(process.cwd(), 'tmp', 'tests');
}

export async function makeRepoTempDir(prefix: string): Promise<string> {
  const root = getTestTmpRoot();
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, `${prefix}-`));
}

export function makeRepoTempDirSync(prefix: string): string {
  const root = getTestTmpRoot();
  mkdirSync(root, { recursive: true });
  return mkdtempSync(path.join(root, `${prefix}-`));
}

export async function removeRepoTempDir(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

export function removeRepoTempDirSync(dir: string | undefined): void {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}
