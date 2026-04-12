import React from 'react';

// StatusBar component for showing connection and authentication status
interface StatusBarProps {
  platformStatus: Record<
    string,
    {
      authenticated: boolean;
      streamStatus: string; // StreamStatus as string
      connectionStatus: 'connected' | 'disconnected' | 'connecting';
      lastError?: string;
    }
  >;
  obsConnected: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({ platformStatus, obsConnected }) => {
  const platforms = Object.keys(platformStatus);

  return (
    <div className="status-bar">
      <div className="status-section obs-status">
        <span className="status-label">OBS:</span>
        <span className={`status-indicator ${obsConnected ? 'connected' : 'disconnected'}`}>
          {obsConnected ? '● Connected' : '● Disconnected'}
        </span>
      </div>

      <div className="status-section platforms-status">
        {platforms.map((platform) => {
          const status = platformStatus[platform];
          const authIndicator = status.authenticated ? '✓' : '✗';
          const streamIndicator =
            status.streamStatus === 'ONLINE'
              ? '●'
              : status.streamStatus === 'OFFLINE'
                ? '○'
                : status.streamStatus === 'STARTING'
                  ? '▶'
                  : status.streamStatus === 'STOPPING'
                    ? '◼'
                    : '▣';
          const connIndicator =
            status.connectionStatus === 'connected'
              ? '●'
              : status.connectionStatus === 'disconnected'
                ? '○'
                : '▶';

          return (
            <div key={platform} className="platform-status">
              <span className="platform-name">{platform.toUpperCase()}:</span>
              <span className="auth-indicator" title="Authentication">
                {authIndicator}
              </span>
              <span className="stream-indicator" title="Stream Status">
                {streamIndicator}
              </span>
              <span className="conn-indicator" title="Connection Status">
                {connIndicator}
              </span>
              {status.lastError && (
                <span className="error-indicator" title={status.lastError}>
                  !
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// In a real implementation with OpenTUI, this would use their components
// For example:
// import { Box, Text, Badge } from '@opentui/components';
//
// export const StatusBar: React.FC<StatusBarProps> = ({ platformStatus, obsConnected }) => {
//   // Implementation using OpenTUI components
// };
