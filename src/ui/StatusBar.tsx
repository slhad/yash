import { baseComponents } from '@opentui/react';

const { Box, Text } = baseComponents;

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
    <Box border="rounded" padding={1} style={{ backgroundColor: '#1a1a2e' }}>
      <Box marginBottom={1}>
        <Text bold>Status</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>OBS: </Text>
        <Text color={obsConnected ? 'green' : 'gray'}>
          {obsConnected ? '● Connected' : '○ Disconnected'}
        </Text>
      </Box>

      {platforms.map((platform) => {
        const status = platformStatus[platform];
        const streamInd = getStreamIndicator(status.streamStatus);

        return (
          <Box key={platform} marginY={0}>
            <Text bold>{platform.toUpperCase()}: </Text>
            <Text color={status.authenticated ? 'green' : 'red'}>
              {status.authenticated ? '✓' : '✗'}
            </Text>{' '}
            <Text color={streamInd.color}>{streamInd.symbol}</Text>
            <Text color={getConnColor(status.connectionStatus)}> {status.connectionStatus}</Text>
            {status.lastError && <Text color="red"> ! {status.lastError}</Text>}
          </Box>
        );
      })}
    </Box>
  );
};
