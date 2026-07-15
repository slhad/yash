import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import * as v8 from 'node:v8';
import { getDataDir } from './config';

export function formatMarkerPosition(positionInSeconds: number): string {
  const h = Math.floor(positionInSeconds / 3600);
  const m = Math.floor((positionInSeconds % 3600) / 60);
  const s = positionInSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function sanitizeSnapshotLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'manual';
}

export function writeHeapSnapshotFile(label?: string): string {
  const dir = `${getDataDir()}/logs/heap-snapshots`;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `-${sanitizeSnapshotLabel(label)}` : '';
  const path = `${dir}/heap-${stamp}-pid${process.pid}${suffix}.heapsnapshot`;
  return v8.writeHeapSnapshot(path);
}

export function writeAutomaticHeapSnapshotFile(maxRetained: number): string {
  const path = writeHeapSnapshotFile('auto-growth');
  const dir = `${getDataDir()}/logs/heap-snapshots`;
  const snapshots = readdirSync(dir)
    .filter((name) => name.startsWith('heap-') && name.endsWith('-auto-growth.heapsnapshot'))
    .map((name) => ({ name, mtimeMs: statSync(`${dir}/${name}`).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of snapshots.slice(Math.max(1, maxRetained))) {
    unlinkSync(`${dir}/${stale.name}`);
  }
  return path;
}
