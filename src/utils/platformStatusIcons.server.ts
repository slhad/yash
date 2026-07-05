import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getDataDir } from './config';
import { defaultLogger } from './logger';
import {
  DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  PLATFORM_STATUS_ICON_PLATFORMS,
  type PlatformStatusIconPlatform,
} from './platformStatusIcons';

const PLATFORM_STATUS_ICON_RASTER_SIZE_PX = Math.max(64, DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX * 4);
const PLATFORM_STATUS_ICON_SOURCE_VERSION = 'v16';

type PlatformStatusIconFiles = {
  svgPath: string;
  pngPath: string;
};

const PLATFORM_STATUS_ICON_SPECS: Record<
  PlatformStatusIconPlatform,
  { remoteUrl: string; fillHex: string }
> = {
  youtube: {
    remoteUrl: `https://cdn.jsdelivr.net/npm/simple-icons@${PLATFORM_STATUS_ICON_SOURCE_VERSION}/icons/youtube.svg`,
    fillHex: '#ff0000',
  },
  twitch: {
    remoteUrl: `https://cdn.jsdelivr.net/npm/simple-icons@${PLATFORM_STATUS_ICON_SOURCE_VERSION}/icons/twitch.svg`,
    fillHex: '#9146ff',
  },
  kick: {
    remoteUrl: `https://cdn.jsdelivr.net/npm/simple-icons@${PLATFORM_STATUS_ICON_SOURCE_VERSION}/icons/kick.svg`,
    fillHex: '#53fc18',
  },
};

const inflightByPlatform = new Map<PlatformStatusIconPlatform, Promise<PlatformStatusIconFiles>>();

function getPlatformStatusIconCacheDir(dataDir = getDataDir()): string {
  return path.join(dataDir, 'cache', 'platform-status-icons');
}

function getPlatformStatusIconSvgPath(
  platform: PlatformStatusIconPlatform,
  dataDir = getDataDir(),
): string {
  return path.join(getPlatformStatusIconCacheDir(dataDir), `${platform}.svg`);
}

function getPlatformStatusIconPngPath(
  platform: PlatformStatusIconPlatform,
  dataDir = getDataDir(),
): string {
  return path.join(getPlatformStatusIconCacheDir(dataDir), `${platform}.png`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeTempAndRename(filePath: string, contents: string | Uint8Array): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, contents);
  await fs.rename(tempPath, filePath);
}

function normalizePlatformStatusIconSvg(svgText: string, fillHex: string): string {
  if (!svgText.includes('<svg')) {
    throw new Error('icon fetch did not return SVG');
  }
  if (/fill="[^"]*"/u.test(svgText)) {
    return svgText.replace(/fill="[^"]*"/u, `fill="${fillHex}"`);
  }
  return svgText.replace('<svg ', `<svg fill="${fillHex}" `);
}

async function downloadPlatformStatusIconSvg(
  platform: PlatformStatusIconPlatform,
): Promise<string> {
  const spec = PLATFORM_STATUS_ICON_SPECS[platform];
  const response = await fetch(spec.remoteUrl);
  if (!response.ok) {
    throw new Error(`icon fetch returned ${response.status} for ${platform}`);
  }
  const svgText = await response.text();
  return normalizePlatformStatusIconSvg(svgText, spec.fillHex);
}

async function runRasterizer(cmd: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' });
    const exitCode = await proc.exited;
    if (exitCode === 0) return true;
    const stderrText = await new Response(proc.stderr).text();
    defaultLogger.warn(
      `[status-icons] ${cmd[0]} exited ${exitCode}${stderrText ? `: ${stderrText.trim()}` : ''}`,
    );
    return false;
  } catch {
    return false;
  }
}

async function rasterizePlatformStatusIconSvg(svgPath: string, pngPath: string): Promise<void> {
  const tempPath = `${pngPath}.tmp-${process.pid}`;
  const rsvgOk = await runRasterizer([
    process.env.YASH_RSVG_CONVERT_COMMAND || 'rsvg-convert',
    svgPath,
    '--width',
    String(PLATFORM_STATUS_ICON_RASTER_SIZE_PX),
    '--height',
    String(PLATFORM_STATUS_ICON_RASTER_SIZE_PX),
    '--format',
    'png',
    '--output',
    tempPath,
  ]);
  if (!rsvgOk) {
    const magickOk = await runRasterizer([
      process.env.YASH_MAGICK_COMMAND || 'magick',
      svgPath,
      '-resize',
      `${PLATFORM_STATUS_ICON_RASTER_SIZE_PX}x${PLATFORM_STATUS_ICON_RASTER_SIZE_PX}`,
      tempPath,
    ]);
    if (!magickOk) {
      throw new Error(`failed to rasterize icon for ${path.basename(svgPath)}`);
    }
  }
  await fs.rename(tempPath, pngPath);
}

async function ensurePlatformStatusIconImpl(
  platform: PlatformStatusIconPlatform,
): Promise<PlatformStatusIconFiles> {
  const cacheDir = getPlatformStatusIconCacheDir();
  const svgPath = getPlatformStatusIconSvgPath(platform);
  const pngPath = getPlatformStatusIconPngPath(platform);
  await fs.mkdir(cacheDir, { recursive: true });
  const spec = PLATFORM_STATUS_ICON_SPECS[platform];
  let svgChanged = false;
  let svgText: string;
  if (await fileExists(svgPath)) {
    const currentSvgText = await fs.readFile(svgPath, 'utf8');
    svgText = normalizePlatformStatusIconSvg(currentSvgText, spec.fillHex);
    if (svgText !== currentSvgText) {
      await writeTempAndRename(svgPath, svgText);
      svgChanged = true;
    }
  } else {
    svgText = await downloadPlatformStatusIconSvg(platform);
    await writeTempAndRename(svgPath, svgText);
    svgChanged = true;
  }
  if (!(await fileExists(pngPath)) || svgChanged) {
    await rasterizePlatformStatusIconSvg(svgPath, pngPath);
  }
  return { svgPath, pngPath };
}

export async function ensurePlatformStatusIcon(
  platform: PlatformStatusIconPlatform,
): Promise<PlatformStatusIconFiles> {
  const existing = inflightByPlatform.get(platform);
  if (existing) return existing;
  const promise = ensurePlatformStatusIconImpl(platform).finally(() => {
    inflightByPlatform.delete(platform);
  });
  inflightByPlatform.set(platform, promise);
  return promise;
}

export function warmPlatformStatusIcons(): void {
  for (const platform of PLATFORM_STATUS_ICON_PLATFORMS) {
    void ensurePlatformStatusIcon(platform).catch((error) => {
      defaultLogger.warn(`[status-icons] Warm fetch failed for ${platform}: ${String(error)}`);
    });
  }
}
