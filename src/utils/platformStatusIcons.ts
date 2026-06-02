export const PLATFORM_STATUS_ICON_SETTING_KEY = 'status.platformIcons.visible';
export const PLATFORM_STATUS_ICON_CACHE_VERSION = 2;
export const PLATFORM_STATUS_ICON_PLATFORMS = ['youtube', 'twitch', 'kick'] as const;
export const DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX = 24;

export type PlatformStatusIconPlatform = (typeof PLATFORM_STATUS_ICON_PLATFORMS)[number];

export function isPlatformStatusIconPlatform(value: string): value is PlatformStatusIconPlatform {
  return PLATFORM_STATUS_ICON_PLATFORMS.includes(value as PlatformStatusIconPlatform);
}

export function readPlatformStatusIconsEnabled(
  getter: (key: string, fallback: boolean) => unknown,
): boolean {
  return String(getter(PLATFORM_STATUS_ICON_SETTING_KEY, false)) === 'true';
}

export function getPlatformStatusIconPlatformSizeSettingKey(
  platform: PlatformStatusIconPlatform,
): string {
  return `status.platformIcons.${platform}.sizePx`;
}

export function readPlatformStatusIconSizePxForPlatform(
  platform: PlatformStatusIconPlatform,
  getter: (key: string, fallback: number) => unknown,
): number {
  const raw = Number(
    getter(
      getPlatformStatusIconPlatformSizeSettingKey(platform),
      DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
    ),
  );
  return clampPlatformStatusIconSizePx(raw, DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX);
}

export function getPlatformStatusIconColumns(sizePx: number): number {
  if (!Number.isFinite(sizePx) || sizePx <= 0) return 1;
  return Math.max(1, Math.min(8, Math.ceil(sizePx / 16)));
}

function clampPlatformStatusIconSizePx(raw: number, fallback: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.max(8, Math.min(128, Math.round(raw)));
}

export function getPlatformStatusIconApiPath(platform: PlatformStatusIconPlatform): string {
  return `/api/assets/platform-icons/${platform}.svg?v=${PLATFORM_STATUS_ICON_CACHE_VERSION}`;
}
