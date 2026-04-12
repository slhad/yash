import React, { useEffect, useState } from 'react';
import { ChatDisplay } from './ChatDisplay';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { StreamControls } from './StreamControls';

// Main dashboard component that combines all UI elements
interface DashboardProps {
  // Services/platforms would be injected here
  // For now, we'll define the interface
  platforms: string[];
  onAuthenticate: (platform: string) => Promise<void>;
  onStartStream: (platforms: string[], metadata: any) => Promise<void>;
  onStopStream: (platforms: string[]) => Promise<void>;
  onUpdateMetadata: (platforms: string[], metadata: any) => Promise<void>;
  onSendMessage: (message: string, targetPlatforms: string[]) => Promise<void>;
  getPlatformStatus: (platform: string) => any; // Returns platform status object
  getObsStatus: () => boolean; // Returns OBS connection status
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
  onAuthenticate,
  onStartStream,
  onStopStream,
  onUpdateMetadata,
  onSendMessage,
  getPlatformStatus,
  getObsStatus,
  getChatMessages,
}) => {
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

  // Initialize status for all platforms
  useEffect(() => {
    const initStatus = {};
    platforms.forEach((platform) => {
      initStatus[platform] = {
        authenticated: false,
        streamStatus: 'OFFLINE' as const,
        connectionStatus: 'disconnected' as const,
        lastError: undefined,
      };
    });

    setAuthStatus(initStatus);
    setStreamStatus(initStatus);
    setConnectionStatus(initStatus);
    setLastError({});
  }, [platforms]);

  // Update statuses periodically
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
          console.error(`Error getting status for ${platform}:`, error);
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

      // Update OBS status
      try {
        setObsConnected(getObsStatus());
      } catch (error) {
        console.error('Error getting OBS status:', error);
        setObsConnected(false);
      }
    };

    // Update every 5 seconds
    const interval = setInterval(updateStatuses, 5000);

    // Initial update
    updateStatuses();

    return () => clearInterval(interval);
  }, [platforms, getPlatformStatus, getObsStatus]);

  // Update messages periodically
  useEffect(() => {
    const updateMessages = () => {
      setMessages(getChatMessages());
    };

    // Update every 2 seconds for new messages
    const interval = setInterval(updateMessages, 2000);

    // Initial update
    updateMessages();

    return () => clearInterval(interval);
  }, [getChatMessages]);

  const handleSendMessage = async (message: string, targetPlatforms: string[]) => {
    try {
      await onSendMessage(message, targetPlatforms);
    } catch (error) {
      console.error('Failed to send message:', error);
      // In a real app, we'd show an error notification
    }
  };

  const handleStartStream = async () => {
    try {
      // In a real app, we'd get metadata from form inputs
      await onStartStream(selectedPlatforms, {
        title: 'My Stream',
        game: 'Just Chatting',
      });
    } catch (error) {
      console.error('Failed to start stream:', error);
      // In a real app, we'd show an error notification
    }
  };

  const handleStopStream = async () => {
    try {
      await onStopStream(selectedPlatforms);
    } catch (error) {
      console.error('Failed to stop stream:', error);
      // In a real app, we'd show an error notification
    }
  };

  const handleUpdateMetadata = async () => {
    try {
      // In a real app, we'd get metadata from form inputs
      await onUpdateMetadata(selectedPlatforms, {
        title: 'Updated Stream Title',
        game: 'Updated Game',
      });
    } catch (error) {
      console.error('Failed to update stream metadata:', error);
      // In a real app, we'd show an error notification
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Yet Another Streamer Helper</h1>
        <div className="dashboard-subtitle">
          Unified platform management for YouTube, Twitch, and Kick
        </div>
      </div>

      <div className="dashboard-body">
        <div className="dashboard-left-panel">
          <StreamControls
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            onSelectPlatforms={setSelectedPlatforms}
            onStartStream={handleStartStream}
            onStopStream={handleStopStream}
            onUpdateMetadata={handleUpdateMetadata}
            getStreamStatus={(platform) => streamStatus[platform] || 'OFFLINE'}
          />

          <StatusBar
            platformStatus={platforms.reduce(
              (acc, platform) => {
                acc[platform] = {
                  authenticated: authStatus[platform] || false,
                  streamStatus: streamStatus[platform] || 'OFFLINE',
                  connectionStatus: connectionStatus[platform] || 'disconnected',
                  lastError: lastError[platform],
                };
                return acc;
              },
              {} as Record<string, any>,
            )}
            obsConnected={obsConnected}
          />
        </div>

        <div className="dashboard-right-panel">
          <div className="chat-container">
            <h2>Unified Chat</h2>
            <ChatDisplay messages={messages} showTimestamps={true} />
          </div>

          <div className="input-container">
            <h2>Send Message</h2>
            <MessageInput
              platforms={platforms}
              selectedPlatforms={selectedPlatforms}
              sendToAll={sendToAll}
              onToggleSendToAll={setSendToAll}
              onSelectPlatforms={setSelectedPlatforms}
              onSendMessage={handleSendMessage}
              placeholder="Type a message to send to selected platforms..."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// In a real implementation with OpenTUI, this would use their components and layout system
// For example, we might use a grid or flexbox layout from OpenTUI
// The actual implementation would depend on the specific OpenTUI components available
