/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';
import {
  buildMemoryInsightSummary,
  formatMemoryStatusDisplay,
  type MemoryInsightSummary,
  readMemoryStatusSettings,
} from '../utils/memoryStatus';
import {
  DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  getPlatformStatusIconApiPath,
  getPlatformStatusIconPlatformSizeSettingKey,
  PLATFORM_STATUS_ICON_SETTING_KEY,
  type PlatformStatusIconPlatform,
  readPlatformStatusIconSizePxForPlatform,
  readPlatformStatusIconsEnabled,
} from '../utils/platformStatusIcons';
import type { RuntimeStatusSnapshot } from '../utils/runtime-monitor';

interface StatusBarProps {
  platformStatus: Record<
    string,
    {
      authenticated: boolean;
      streamStatus: string;
      connectionStatus: 'connected' | 'disconnected' | 'connecting';
      lastError?: string;
      viewerCount?: number;
      streamStartTime?: string | null;
    }
  >;
  obsConnected: boolean;
}

type StatusColor = keyof typeof colorMap;

const colorMap = {
  green: '#22c55e',
  red: '#ef4444',
  gray: '#6b7280',
  yellow: '#eab308',
  cyan: '#06b6d4',
  purple: '#a855f7',
  white: '#ffffff',
} as const;

function formatElapsed(isoString: string): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

export const StatusBar: React.FC<StatusBarProps> = ({ platformStatus, obsConnected }) => {
  const [, setTick] = useState(0);
  const [memoryInsight, setMemoryInsight] = useState<MemoryInsightSummary | null>(null);
  const [memoryDetailsOpen, setMemoryDetailsOpen] = useState(false);
  const [platformIconsVisible, setPlatformIconsVisible] = useState(false);
  const [platformIconSizePxByPlatform, setPlatformIconSizePxByPlatform] = useState<
    Record<PlatformStatusIconPlatform, number>
  >({
    youtube: DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
    twitch: DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
    kick: DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  });
  const [iconLoadFailures, setIconLoadFailures] = useState<
    Partial<Record<PlatformStatusIconPlatform, boolean>>
  >({});
  const [memoryDisplay, setMemoryDisplay] = useState<{
    visible: boolean;
    text: string;
    color: string;
  }>({
    visible: false,
    text: '',
    color: colorMap.gray,
  });

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const getNestedValue = (source: unknown, key: string): unknown => {
      if (!source || typeof source !== 'object') return undefined;
      let current: unknown = source;
      for (const part of key.split('.')) {
        if (!current || typeof current !== 'object' || !(part in current)) return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    };

    const loadMemoryStatus = async () => {
      try {
        const [settingsRes, runtimeRes] = await Promise.all([
          fetch('/api/settings'),
          fetch('/api/runtime/status'),
        ]);
        if (!settingsRes.ok || !runtimeRes.ok || cancelled) return;
        const settingsData = await settingsRes.json();
        const runtimeData = (await runtimeRes.json()) as RuntimeStatusSnapshot;
        if (cancelled) return;
        const settings = readMemoryStatusSettings(
          (key, fallback) => getNestedValue(settingsData, key) ?? fallback,
        );
        setPlatformIconsVisible(
          readPlatformStatusIconsEnabled(
            (key, fallback) => getNestedValue(settingsData, key) ?? fallback,
          ),
        );
        setPlatformIconSizePxByPlatform({
          youtube: readPlatformStatusIconSizePxForPlatform(
            'youtube',
            (key, fallback) => getNestedValue(settingsData, key) ?? fallback,
          ),
          twitch: readPlatformStatusIconSizePxForPlatform(
            'twitch',
            (key, fallback) => getNestedValue(settingsData, key) ?? fallback,
          ),
          kick: readPlatformStatusIconSizePxForPlatform(
            'kick',
            (key, fallback) => getNestedValue(settingsData, key) ?? fallback,
          ),
        });
        if (!settings.visible) {
          setMemoryDisplay({ visible: false, text: '', color: colorMap.gray });
          setMemoryInsight(null);
          setMemoryDetailsOpen(false);
          return;
        }
        const display = formatMemoryStatusDisplay(runtimeData.memory.rssBytes, settings);
        setMemoryInsight(buildMemoryInsightSummary(runtimeData, settings));
        const color =
          display.level === 'green'
            ? colorMap.green
            : display.level === 'yellow'
              ? colorMap.yellow
              : display.level === 'orange'
                ? '#f97316'
                : colorMap.red;
        setMemoryDisplay({ visible: true, text: display.text, color });
      } catch {}
    };

    const loop = async () => {
      if (cancelled) return;
      await loadMemoryStatus();
      if (!cancelled) {
        timeoutId = setTimeout(() => {
          void loop();
        }, 5000);
      }
    };

    const handleSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (
        !detail?.key?.startsWith('memory.status.') &&
        detail?.key !== PLATFORM_STATUS_ICON_SETTING_KEY &&
        detail?.key !== getPlatformStatusIconPlatformSizeSettingKey('youtube') &&
        detail?.key !== getPlatformStatusIconPlatformSizeSettingKey('twitch') &&
        detail?.key !== getPlatformStatusIconPlatformSizeSettingKey('kick')
      ) {
        return;
      }
      void loadMemoryStatus();
    };

    void loop();
    window.addEventListener('yash:settings-changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('yash:settings-changed', handleSettingsChanged);
    };
  }, []);

  useEffect(() => {
    if (!platformIconsVisible) {
      return;
    }
    setIconLoadFailures({});
  }, [platformIconsVisible]);

  const platforms = Object.keys(platformStatus);

  const getStreamIndicator = (status: string): { symbol: string; color: StatusColor } => {
    switch (status) {
      case 'ONLINE':
        return { symbol: '●', color: 'green' };
      case 'OFFLINE':
        return { symbol: '○', color: 'gray' };
      case 'STARTING':
        return { symbol: '▶', color: 'yellow' };
      case 'STOPPING':
        return { symbol: '◼', color: 'yellow' };
      case 'ERROR':
        return { symbol: '✗', color: 'red' };
      default:
        return { symbol: '?', color: 'gray' };
    }
  };

  const getConnColor = (status: string): StatusColor => {
    switch (status) {
      case 'connected':
        return 'green';
      case 'disconnected':
        return 'gray';
      case 'connecting':
        return 'yellow';
      default:
        return 'gray';
    }
  };

  return (
    <div
      style={{
        border: '1px solid #444',
        borderRadius: '4px',
        padding: '8px',
        backgroundColor: '#1a1a2e',
      }}
    >
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontWeight: 'bold' }}>Status</span>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <span>OBS: </span>
        <span style={{ color: obsConnected ? '#22c55e' : '#6b7280' }}>
          {obsConnected ? '● Connected' : '○ Disconnected'}
        </span>
      </div>

      {memoryDisplay.visible && (
        <button
          type="button"
          onClick={() => setMemoryDetailsOpen(true)}
          style={{
            marginBottom: '8px',
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: '1px solid #3b3b52',
            borderRadius: '4px',
            padding: '6px 8px',
            cursor: 'pointer',
          }}
        >
          <span>Memory: </span>
          <span style={{ color: memoryDisplay.color }}>{memoryDisplay.text}</span>
          <span style={{ color: '#6b7280' }}> click for details</span>
        </button>
      )}

      {memoryDetailsOpen && memoryInsight && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 'min(860px, 92vw)',
              maxHeight: '80vh',
              overflowY: 'auto',
              backgroundColor: '#111827',
              border: `1px solid ${memoryDisplay.color}`,
              borderRadius: '8px',
              padding: '16px',
              boxShadow: '0 18px 40px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 'bold', color: '#ffffff' }}>Memory Status</div>
                <div style={{ color: memoryDisplay.color }}>
                  {memoryInsight.title} | {memoryInsight.statusText}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMemoryDetailsOpen(false)}
                style={{
                  backgroundColor: '#1f2937',
                  color: '#ffffff',
                  border: '1px solid #374151',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {memoryInsight.lines.map((line) => (
                <div
                  key={line.text}
                  style={{
                    color:
                      line.tone === 'good'
                        ? colorMap.green
                        : line.tone === 'warn'
                          ? colorMap.yellow
                          : line.tone === 'danger'
                            ? colorMap.red
                            : line.tone === 'muted'
                              ? colorMap.gray
                              : colorMap.white,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.4,
                  }}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {platforms.map((platform) => {
        const status = platformStatus[platform];
        if (!status) return null;
        const streamInd = getStreamIndicator(status.streamStatus);

        const showStats = status.streamStatus === 'ONLINE' && status.viewerCount !== undefined;
        const elapsedStr =
          showStats && status.streamStartTime ? formatElapsed(status.streamStartTime) : null;
        const statsLabel = showStats
          ? elapsedStr
            ? `(${elapsedStr} / ${status.viewerCount} viewers)`
            : `(${status.viewerCount} viewers)`
          : null;

        const iconSizePx =
          platformIconSizePxByPlatform[platform as PlatformStatusIconPlatform] ??
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX;

        return (
          <div key={platform}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 'bold',
              }}
            >
              {platformIconsVisible && !iconLoadFailures[platform as PlatformStatusIconPlatform] ? (
                <img
                  src={getPlatformStatusIconApiPath(platform as PlatformStatusIconPlatform)}
                  alt={`${platform} logo`}
                  width={iconSizePx}
                  height={iconSizePx}
                  loading="lazy"
                  onError={() =>
                    setIconLoadFailures((current) => ({
                      ...current,
                      [platform]: true,
                    }))
                  }
                  style={{
                    display: 'inline-block',
                    width: `${iconSizePx}px`,
                    height: `${iconSizePx}px`,
                    objectFit: 'contain',
                    verticalAlign: 'middle',
                  }}
                />
              ) : (
                <span>{platform.toUpperCase()}</span>
              )}
              <span>:</span>
            </span>{' '}
            <span style={{ color: status.authenticated ? '#22c55e' : '#ef4444' }}>
              {status.authenticated ? '✓' : '✗'}
            </span>{' '}
            <span style={{ color: colorMap[streamInd.color] ?? streamInd.color }}>
              {streamInd.symbol}
            </span>
            <span
              style={{
                color:
                  colorMap[getConnColor(status.connectionStatus)] ??
                  getConnColor(status.connectionStatus),
              }}
            >
              {' '}
              {status.connectionStatus}
            </span>
            {statsLabel && <span style={{ color: '#6b7280' }}> {statsLabel}</span>}
            {status.lastError && <span style={{ color: '#ef4444' }}> ! {status.lastError}</span>}
          </div>
        );
      })}
    </div>
  );
};
