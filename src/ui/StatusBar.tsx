import React from 'react';

interface StatusBarProps {
  platformStatus: Record<
    string,
    {
      authenticated: boolean;
      streamStatus: string;
      connectionStatus: 'connected' | 'disconnected' | 'connecting';
      lastError?: string;
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

export const StatusBar: React.FC<StatusBarProps> = ({ platformStatus, obsConnected }) => {
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
        const streamInd = getStreamIndicator(status.streamStatus);

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
            {status.lastError && <span style={{ color: '#ef4444' }}> ! {status.lastError}</span>}
          </div>
        );
      })}
    </div>
  );
};
