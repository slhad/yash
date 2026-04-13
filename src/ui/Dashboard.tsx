import { baseComponents } from '@opentui/react';

const { Box, Text, Button } = baseComponents;

import React, { useEffect, useState } from 'react';
import { ChatDisplay } from './ChatDisplay';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { StreamControls } from './StreamControls';

interface DashboardProps {
  platforms: string[];
  onAuthenticate: (platform: string) => Promise<void>;
  onStartStream: (platforms: string[], metadata: any) => Promise<void>;
  onStopStream: (platforms: string[]) => Promise<void>;
  onUpdateMetadata: (platforms: string[], metadata: any) => Promise<void>;
  onSendMessage: (message: string, targetPlatforms: string[]) => Promise<void>;
  getPlatformStatus: (platform: string) => any;
  getObsStatus: () => boolean;
  getChatMessages: () => Array<{
    id: string;
    platform: string;
    username: string;
    message: string;
    timestamp: number;
  }>;
}

export const Dashboard: React.FC<DashboardProps> = ({
  platforms,
  onAuthenticate: _onAuthenticate,
  onStartStream,
  onStopStream,
  onUpdateMetadata,
  onSendMessage,
  getPlatformStatus,
  getObsStatus,
  getChatMessages,
}) => {
  // Settings store (file-backed). We use it to persist simple UI preferences.
  // Initialize lazily so server-side rendering or test runs don't block.
  const [settings] = useState(() => new (require('../utils/settings').default)());

  // Whether to show the settings panel
  const [showSettings, setShowSettings] = useState(false);

  // Persisted setting: whether to show the platform status panel
  const [showPlatformStatus, setShowPlatformStatus] = useState<boolean>(() =>
    settings.get('showPlatformStatus', true),
  );

  // When showPlatformStatus changes, persist it
  useEffect(() => {
    // write asynchronously
    void settings.set('showPlatformStatus', showPlatformStatus);
  }, [showPlatformStatus, settings]);
  const [authStatus, setAuthStatus] = useState<Record<string, boolean>>({});
  const [streamStatus, setStreamStatus] = useState<Record<string, string>>({});
  const [connectionStatus, setConnectionStatus] = useState<Record<string, string>>({});
  const [lastError, setLastError] = useState<Record<string, string | undefined>>({});
  const [obsConnected, setObsConnected] = useState(false);
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      platform: string;
      username: string;
      message: string;
      timestamp: number;
    }>
  >([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [sendToAll, setSendToAll] = useState(true);

  useEffect(() => {
    // Initialize status objects with the correct types for each state
    const initAuthStatus: Record<string, boolean> = {};
    const initStreamStatus: Record<string, string> = {};
    const initConnectionStatus: Record<string, string> = {};

    platforms.forEach((platform) => {
      initAuthStatus[platform] = false;
      initStreamStatus[platform] = 'OFFLINE';
      initConnectionStatus[platform] = 'disconnected';
    });

    setAuthStatus(initAuthStatus);
    setStreamStatus(initStreamStatus);
    setConnectionStatus(initConnectionStatus);
    setLastError({});
  }, [platforms]);

  useEffect(() => {
    const updateStatuses = async () => {
      const newAuthStatus: Record<string, boolean> = {};
      const newStreamStatus: Record<string, string> = {};
      const newConnectionStatus: Record<string, string> = {};
      const newLastError: Record<string, string | undefined> = {};

      for (const platform of platforms) {
        try {
          const status = getPlatformStatus(platform);
          newAuthStatus[platform] = status.authenticated;
          newStreamStatus[platform] = status.streamStatus;
          newConnectionStatus[platform] = status.connectionStatus;
          newLastError[platform] = status.lastError;
        } catch (error) {
          newAuthStatus[platform] = false;
          newStreamStatus[platform] = 'ERROR';
          newConnectionStatus[platform] = 'disconnected';
          newLastError[platform] = error.message || 'Unknown error';
        }
      }

      setAuthStatus(newAuthStatus);
      setStreamStatus(newStreamStatus);
      setConnectionStatus(newConnectionStatus);
      setLastError(newLastError);

      try {
        setObsConnected(getObsStatus());
      } catch {
        setObsConnected(false);
      }
    };

    const interval = setInterval(updateStatuses, 5000);
    updateStatuses();

    return () => clearInterval(interval);
  }, [platforms, getPlatformStatus, getObsStatus]);

  useEffect(() => {
    const updateMessages = () => {
      setMessages(getChatMessages());
    };

    const interval = setInterval(updateMessages, 2000);
    updateMessages();

    return () => clearInterval(interval);
  }, [getChatMessages]);

  const handleStartStream = async () => {
    await onStartStream(selectedPlatforms, {
      title: 'My Stream',
      game: 'Just Chatting',
    });
  };

  const handleStopStream = async () => {
    await onStopStream(selectedPlatforms);
  };

  const handleUpdateMetadata = async () => {
    await onUpdateMetadata(selectedPlatforms, {
      title: 'Updated Stream Title',
      game: 'Updated Game',
    });
  };

  const getStreamStatusFn = (platform: string) => streamStatus[platform] || 'OFFLINE';

  const combinedPlatformStatus = platforms.reduce(
    (acc, platform) => {
      acc[platform] = {
        authenticated: authStatus[platform] || false,
        streamStatus: streamStatus[platform] || 'OFFLINE',
        connectionStatus:
          (connectionStatus[platform] as 'connected' | 'disconnected' | 'connecting') ||
          'disconnected',
        lastError: lastError[platform],
      };
      return acc;
    },
    {} as Record<string, any>,
  );

  return (
    <Box padding={1} style={{ backgroundColor: '#0f0f1a' }}>
      <Box marginBottom={1}>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Box>
            <Text bold color="cyan" fontSize={2}>
              YASH - Yet Another Streamer Helper
            </Text>
            <Text color="gray">Unified platform management for YouTube, Twitch, and Kick</Text>
          </Box>
          <Box marginLeft="auto">
            <Button onClick={() => setShowSettings((s) => !s)} style={{ backgroundColor: '#333' }}>
              {showSettings ? 'Close Settings' : 'Settings'}
            </Button>
          </Box>
        </Box>
        {showSettings && (
          <Box marginTop={1} border="rounded" padding={1} width="50%">
            <Text bold>UI Settings</Text>
            <Box marginTop={1} flexDirection="row" gap={1} alignItems="center">
              <Button
                onClick={() => setShowPlatformStatus((v) => !v)}
                style={{ backgroundColor: showPlatformStatus ? 'green' : '#333' }}
              >
                {showPlatformStatus ? '[x] Show Platform Status' : '[ ] Show Platform Status'}
              </Button>
            </Box>
          </Box>
        )}
      </Box>

      <Box flexDirection="row" gap={1}>
        <Box flexDirection="column" gap={1} width="50%">
          <StreamControls
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            onSelectPlatforms={setSelectedPlatforms}
            onStartStream={handleStartStream}
            onStopStream={handleStopStream}
            onUpdateMetadata={handleUpdateMetadata}
            getStreamStatus={getStreamStatusFn}
          />

          {showPlatformStatus && (
            <StatusBar platformStatus={combinedPlatformStatus} obsConnected={obsConnected} />
          )}
        </Box>

        <Box flexDirection="column" gap={1} width="50%">
          <Box border="rounded" padding={1} style={{ backgroundColor: '#1a1a2e' }}>
            <Box marginBottom={1}>
              <Text bold>Unified Chat</Text>
            </Box>
            <ChatDisplay messages={messages} showTimestamps={true} />
          </Box>

          <MessageInput
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            sendToAll={sendToAll}
            onToggleSendToAll={setSendToAll}
            onSelectPlatforms={setSelectedPlatforms}
            onSendMessage={onSendMessage}
            placeholder="Type a message..."
          />
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
