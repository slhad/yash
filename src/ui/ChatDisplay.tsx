import { baseComponents } from '@opentui/react';

const { Box, Scrollbox, Text } = baseComponents;

import React from 'react';

interface ChatDisplayProps {
  messages: Array<{
    id: string;
    platform: string;
    username: string;
    message: string;
    timestamp: number;
  }>;
  showTimestamps?: boolean;
}

export const ChatDisplay: React.FC<ChatDisplayProps> = ({ messages, showTimestamps = true }) => {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getPlatformColor = (platform: string) => {
    switch (platform) {
      case 'youtube':
        return 'red';
      case 'twitch':
        return 'purple';
      case 'kick':
        return 'green';
      default:
        return 'white';
    }
  };

  return (
    <Box border="rounded" padding={1} height={20} style={{ backgroundColor: '#1a1a2e' }}>
      <Scrollbox autoScroll>
        {messages.length === 0 ? (
          <Text color="gray">No messages yet...</Text>
        ) : (
          messages.map((msg) => (
            <Box key={msg.id} marginY={0}>
              <Text>
                {showTimestamps && <Text color="gray">[{formatTime(msg.timestamp)}] </Text>}
                <Text color={getPlatformColor(msg.platform)} bold>
                  [{msg.platform}]
                </Text>{' '}
                <Text color="cyan">{msg.username}:</Text> {msg.message}
              </Text>
            </Box>
          ))
        )}
      </Scrollbox>
    </Box>
  );
};
