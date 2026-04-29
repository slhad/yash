/** @jsxImportSource react */
import React, { useEffect, useState } from 'react';

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

const colorMap: Record<string, string> = {
  green: '#22c55e',
  red: '#ef4444',
  gray: '#6b7280',
  yellow: '#eab308',
  cyan: '#06b6d4',
  purple: '#a855f7',
  white: '#ffffff',
};

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

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const platforms = Object.keys(platformStatus);

  const getStreamIndicator = (status: string) => {
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

  const getConnColor = (status: string) => {
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

        return (
          <div key={platform}>
            <span style={{ fontWeight: 'bold' }}>{platform.toUpperCase()}: </span>
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
