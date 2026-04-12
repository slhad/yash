import { Box, Button, Input, Text } from '@opentui/react';
import React, { useState } from 'react';

interface StreamControlsProps {
  platforms: string[];
  selectedPlatforms: string[];
  onSelectPlatforms: (platforms: string[]) => void;
  onStartStream: () => Promise<void>;
  onStopStream: () => Promise<void>;
  onUpdateMetadata: () => Promise<void>;
  getStreamStatus: (platform: string) => string;
}

export const StreamControls: React.FC<StreamControlsProps> = ({
  platforms,
  selectedPlatforms,
  onSelectPlatforms,
  onStartStream,
  onStopStream,
  onUpdateMetadata,
  getStreamStatus,
}) => {
  const [streamTitle, setStreamTitle] = useState('');
  const [streamGame, setStreamGame] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const togglePlatform = (platform: string) => {
    if (selectedPlatforms.includes(platform)) {
      onSelectPlatforms(selectedPlatforms.filter((p) => p !== platform));
    } else {
      onSelectPlatforms([...selectedPlatforms, platform]);
    }
  };

  const toggleAll = () => {
    if (selectedPlatforms.length === platforms.length) {
      onSelectPlatforms([]);
    } else {
      onSelectPlatforms([...platforms]);
    }
  };

  const anyOnline = selectedPlatforms.some((p) => getStreamStatus(p) === 'ONLINE');

  const handleStart = async () => {
    setIsProcessing(true);
    try {
      await onStartStream();
    } catch (error) {
      console.error('Failed to start stream:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    setIsProcessing(true);
    try {
      await onStopStream();
    } catch (error) {
      console.error('Failed to stop stream:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdate = async () => {
    setIsProcessing(true);
    try {
      await onUpdateMetadata();
    } catch (error) {
      console.error('Failed to update metadata:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Box border="rounded" padding={1} style={{ backgroundColor: '#1a1a2e' }}>
      <Box marginBottom={1}>
        <Text bold>Stream Controls</Text>
      </Box>

      <Box marginBottom={1}>
        <Button
          onClick={toggleAll}
          style={{
            backgroundColor: selectedPlatforms.length === platforms.length ? 'blue' : '#333',
          }}
        >
          {selectedPlatforms.length === platforms.length ? '[x] All' : '[ ] All'}
        </Button>
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

      <Box marginBottom={1}>
        <Text>
          {anyOnline ? <Text color="green">● LIVE</Text> : <Text color="gray">○ Offline</Text>}
        </Text>
        <Text color="gray">
          {' '}
          {selectedPlatforms.length > 0 ? `${selectedPlatforms.length} selected` : 'None selected'}
        </Text>
      </Box>

      {!anyOnline && (
        <Box marginBottom={1} flexDirection="column" gap={1}>
          <Input
            label="Title"
            value={streamTitle}
            onChange={setStreamTitle}
            placeholder="Stream title"
          />
          <Input
            label="Game"
            value={streamGame}
            onChange={setStreamGame}
            placeholder="Game/category"
          />
        </Box>
      )}

      <Box flexDirection="row" gap={1}>
        <Button
          onClick={anyOnline ? handleStop : handleStart}
          disabled={selectedPlatforms.length === 0 || isProcessing}
          style={{
            backgroundColor: anyOnline ? 'red' : 'green',
          }}
        >
          {anyOnline ? 'Stop' : 'Start'}
        </Button>
        <Button
          onClick={handleUpdate}
          disabled={!anyOnline || isProcessing}
          style={{ backgroundColor: 'yellow' }}
        >
          Update
        </Button>
      </Box>
    </Box>
  );
};
