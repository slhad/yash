import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  getPlatformStatusIconApiPath,
  getPlatformStatusIconColumns,
  getPlatformStatusIconPlatformSizeSettingKey,
  isPlatformStatusIconPlatform,
  PLATFORM_STATUS_ICON_CACHE_VERSION,
  PLATFORM_STATUS_ICON_SETTING_KEY,
  readPlatformStatusIconSizePxForPlatform,
  readPlatformStatusIconsEnabled,
} from '../src/utils/platformStatusIcons';
import {
  ensurePlatformStatusIcon,
  ensurePlatformStatusIconSvg,
} from '../src/utils/platformStatusIcons.server';
import { makeRepoTempDir, removeRepoTempDir } from './helpers/testDataDir';

const originalDataDir = process.env.YASH_DATA_DIR;
const originalPath = process.env.PATH;
const originalFetch = globalThis.fetch;
const originalRsvgCommand = process.env.YASH_RSVG_CONVERT_COMMAND;
const originalMagickCommand = process.env.YASH_MAGICK_COMMAND;
let tempDir: string | undefined;

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.YASH_DATA_DIR;
  else process.env.YASH_DATA_DIR = originalDataDir;
  process.env.PATH = originalPath;
  if (originalRsvgCommand === undefined) delete process.env.YASH_RSVG_CONVERT_COMMAND;
  else process.env.YASH_RSVG_CONVERT_COMMAND = originalRsvgCommand;
  if (originalMagickCommand === undefined) delete process.env.YASH_MAGICK_COMMAND;
  else process.env.YASH_MAGICK_COMMAND = originalMagickCommand;
  globalThis.fetch = originalFetch;
  await removeRepoTempDir(tempDir);
  tempDir = undefined;
});

async function installFakeRasterizer(binDir: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  const rsvgPath = path.join(binDir, 'rsvg-convert');
  await fs.writeFile(
    rsvgPath,
    `#!/usr/bin/env sh\nout=""\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--output" ]; then\n    shift\n    out="$1"\n  fi\n  shift\ndone\nprintf 'png' > "$out"\n`,
  );
  await fs.chmod(rsvgPath, 0o755);

  const magickPath = path.join(binDir, 'magick');
  await fs.writeFile(
    magickPath,
    `#!/usr/bin/env sh\nlast=""\nfor arg in "$@"; do\n  last="$arg"\ndone\nprintf 'png' > "$last"\n`,
  );
  await fs.chmod(magickPath, 0o755);
  process.env.PATH = `${binDir}:${originalPath ?? ''}`;
  process.env.YASH_RSVG_CONVERT_COMMAND = rsvgPath;
  process.env.YASH_MAGICK_COMMAND = magickPath;
}

describe('platform status icon settings', () => {
  test('recognizes supported platform names', () => {
    expect(isPlatformStatusIconPlatform('youtube')).toBe(true);
    expect(isPlatformStatusIconPlatform('twitch')).toBe(true);
    expect(isPlatformStatusIconPlatform('kick')).toBe(true);
    expect(isPlatformStatusIconPlatform('mixer')).toBe(false);
  });

  test('reads the enabled flag from the configured setting key', () => {
    const seen: string[] = [];
    const enabled = readPlatformStatusIconsEnabled((key, fallback) => {
      seen.push(`${key}:${fallback}`);
      return true;
    });

    expect(enabled).toBe(true);
    expect(seen).toEqual([`${PLATFORM_STATUS_ICON_SETTING_KEY}:false`]);
    expect(readPlatformStatusIconsEnabled((_key, fallback) => fallback)).toBe(false);
  });

  test('builds per-platform size setting keys', () => {
    expect(getPlatformStatusIconPlatformSizeSettingKey('youtube')).toBe(
      'status.platformIcons.youtube.sizePx',
    );
    expect(getPlatformStatusIconPlatformSizeSettingKey('twitch')).toBe(
      'status.platformIcons.twitch.sizePx',
    );
    expect(getPlatformStatusIconPlatformSizeSettingKey('kick')).toBe(
      'status.platformIcons.kick.sizePx',
    );
  });

  test('reads and clamps per-platform icon sizes', () => {
    expect(readPlatformStatusIconSizePxForPlatform('youtube', () => 32.4)).toBe(32);
    expect(readPlatformStatusIconSizePxForPlatform('youtube', () => 2)).toBe(8);
    expect(readPlatformStatusIconSizePxForPlatform('youtube', () => 999)).toBe(128);
    expect(readPlatformStatusIconSizePxForPlatform('youtube', () => Number.NaN)).toBe(
      DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
    );
  });

  test('converts icon pixel sizes to terminal columns', () => {
    expect(getPlatformStatusIconColumns(0)).toBe(1);
    expect(getPlatformStatusIconColumns(1)).toBe(1);
    expect(getPlatformStatusIconColumns(16)).toBe(1);
    expect(getPlatformStatusIconColumns(17)).toBe(2);
    expect(getPlatformStatusIconColumns(128)).toBe(8);
    expect(getPlatformStatusIconColumns(999)).toBe(8);
    expect(getPlatformStatusIconColumns(Number.NaN)).toBe(1);
  });

  test('builds cache-versioned API paths', () => {
    expect(getPlatformStatusIconApiPath('kick')).toBe(
      `/api/assets/platform-icons/kick.svg?v=${PLATFORM_STATUS_ICON_CACHE_VERSION}`,
    );
  });

  test('ensurePlatformStatusIconSvg does not require a PNG rasterizer', async () => {
    tempDir = await makeRepoTempDir('platform-icons-svg-only');
    process.env.YASH_DATA_DIR = tempDir;
    process.env.YASH_RSVG_CONVERT_COMMAND = path.join(tempDir, 'missing-rsvg-convert');
    process.env.YASH_MAGICK_COMMAND = path.join(tempDir, 'missing-magick');
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('<svg viewBox="0 0 1 1"><path /></svg>', { status: 200 });
    }) as unknown as typeof fetch;

    const svgPath = await ensurePlatformStatusIconSvg('twitch');

    expect(fetchCount).toBe(1);
    expect(svgPath).toContain(path.join('cache', 'platform-status-icons', 'twitch.svg'));
    expect(await fs.readFile(svgPath, 'utf8')).toContain('fill="#9146ff"');
    expect(
      await fs.stat(path.join(path.dirname(svgPath), 'twitch.png')).catch(() => null),
    ).toBeNull();
  });

  test('ensurePlatformStatusIcon downloads, recolors, caches, and rasterizes icons', async () => {
    tempDir = await makeRepoTempDir('platform-icons');
    process.env.YASH_DATA_DIR = tempDir;
    await installFakeRasterizer(path.join(tempDir, 'bin'));
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('<svg viewBox="0 0 1 1"><path /></svg>', { status: 200 });
    }) as unknown as typeof fetch;

    const first = await ensurePlatformStatusIcon('youtube');
    const second = await ensurePlatformStatusIcon('youtube');

    expect(second).toEqual(first);
    expect(fetchCount).toBe(1);
    expect(first.svgPath).toContain(path.join('cache', 'platform-status-icons', 'youtube.svg'));
    expect(first.pngPath).toContain(path.join('cache', 'platform-status-icons', 'youtube.png'));
    expect(await fs.readFile(first.svgPath, 'utf8')).toContain('fill="#ff0000"');
    expect((await fs.readFile(first.pngPath)).byteLength).toBeGreaterThan(0);
  });

  test('ensurePlatformStatusIcon repairs cached SVG fill without downloading again', async () => {
    tempDir = await makeRepoTempDir('platform-icons-existing');
    process.env.YASH_DATA_DIR = tempDir;
    await installFakeRasterizer(path.join(tempDir, 'bin'));
    const cacheDir = path.join(tempDir, 'cache', 'platform-status-icons');
    await fs.mkdir(cacheDir, { recursive: true });
    const svgPath = path.join(cacheDir, 'kick.svg');
    await fs.writeFile(svgPath, '<svg fill="#000000" viewBox="0 0 1 1"><path /></svg>');
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;

    const result = await ensurePlatformStatusIcon('kick');

    expect(fetched).toBe(false);
    expect(result.svgPath).toBe(svgPath);
    expect(await fs.readFile(svgPath, 'utf8')).toContain('fill="#53fc18"');
    expect((await fs.readFile(result.pngPath)).byteLength).toBeGreaterThan(0);
  });
});
