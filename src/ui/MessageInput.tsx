import { baseComponents } from '@opentui/react';

const { Box, Button, Input, Text } = baseComponents;

import React, { useState } from 'react';

interface MessageInputProps {
  onSendMessage: (message: string, targetPlatforms: string[]) => void;
  platforms: string[];
  selectedPlatforms: string[];
  sendToAll: boolean;
  onToggleSendToAll: (value: boolean) => void;
  onSelectPlatforms: (platforms: string[]) => void;
  placeholder?: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  platforms,
  selectedPlatforms,
  sendToAll,
  onToggleSendToAll,
  onSelectPlatforms,
  placeholder = 'Type a message...',
}) => {
  const [message, setMessage] = useState('');

  const handleSend = async () => {
    if (message.trim()) {
      await onSendMessage(message, sendToAll ? [] : selectedPlatforms);
      setMessage('');
    }
  };

  const togglePlatform = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      onSelectPlatforms(selectedPlatforms.filter((p) => p !== platform));
    } else {
      onSelectPlatforms([...selectedPlatforms, platform]);
    }
  };

  return (
    <Box border="rounded" padding={1} style={{ backgroundColor: '#1a1a2e' }}>
      <Box marginBottom={1}>
        <Text bold>Send Message</Text>
      </Box>

      <Box marginBottom={1}>
        <Button
          onClick={() => onToggleSendToAll(!sendToAll)}
          style={{
            backgroundColor: sendToAll ? 'green' : '#333',
          }}
        >
          {sendToAll ? '[x] Send to All' : '[ ] Send to All'}
        </Button>
      </Box>

      {!sendToAll && platforms.length > 0 && (
        <Box marginBottom={1} flexDirection="row" gap={1}>
          <Text>Send to:</Text>
          {platforms.map((platform) => (
            <Button
              key={platform}
              onClick={() => togglePlatform(platform)}
              style={{
                backgroundColor: selectedPlatforms.includes(platform) ? 'blue' : '#333',
              }}
            >
              {selectedPlatforms.includes(platform) ? '[x]' : '[ ]'}{' '}
              {platform.charAt(0).toUpperCase() + platform.slice(1)}
            </Button>
          ))}
        </Box>
      )}

      <Input
        value={message}
        onChange={(value) => setMessage(value)}
        placeholder={placeholder}
        onEnter={handleSend}
      />

      <Box marginTop={1}>
        <Button onClick={handleSend} style={{ backgroundColor: 'blue' }}>
          Send
        </Button>
      </Box>
    </Box>
  );
};
