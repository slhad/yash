/** @jsxImportSource react */
import React, { useEffect, useRef, useState } from 'react';
import type { FfzEmoteDefinition } from '../utils/ffz';
import { ChatDisplay } from './ChatDisplay';
import { MessageInput } from './MessageInput';
import { StatusBar } from './StatusBar';
import { StreamControls, type StreamMetadata } from './StreamControls';

const FFZ_RETRY_INTERVAL_MS = 5_000;
const FFZ_REFRESH_INTERVAL_MS = 5 * 60_000;

interface DashboardProps {
  platforms: string[];
  onAuthenticate: (platform: string) => Promise<void>;
  onUpdateMetadata: (platforms: string[], metadata: any) => Promise<void>;
  onSendMessage: (message: string, targetPlatforms: string[]) => Promise<void>;
  getPlatformStatus: (platform: string) => any;
  getObsStatus: () => boolean;
  getChatMessages: () => Promise<
    Array<{
      id: string;
      platform: string;
      username: string;
      message: string;
      timestamp: number;
    }>
  >;
}

export const Dashboard: React.FC<DashboardProps> = ({
  platforms,
  onAuthenticate: _onAuthenticate,
  onUpdateMetadata,
  onSendMessage,
  getPlatformStatus,
  getObsStatus,
  getChatMessages,
}) => {
  // Whether to show the settings panel
  const [showSettings, setShowSettings] = useState(false);

  // Persisted setting: whether to show the platform status panel (browser localStorage)
  const [showPlatformStatus, setShowPlatformStatus] = useState<boolean>(() => {
    try {
      return localStorage.getItem('yash_showPlatformStatus') !== 'false';
    } catch {
      return true;
    }
  });
  const [showChatTimestamps, setShowChatTimestamps] = useState(true);

  // When showPlatformStatus changes, persist it
  useEffect(() => {
    try {
      localStorage.setItem('yash_showPlatformStatus', String(showPlatformStatus));
    } catch {}
  }, [showPlatformStatus]);

  useEffect(() => {
    let cancelled = false;

    const loadChatTimestampSetting = async () => {
      try {
        const res = await fetch('/api/settings?key=chat.timestamps.visible');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setShowChatTimestamps(data.value !== false);
      } catch {}
    };

    const handleSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (!detail || detail.key !== 'chat.timestamps.visible') return;
      setShowChatTimestamps(detail.value !== false);
    };

    void loadChatTimestampSetting();
    window.addEventListener('yash:settings-changed', handleSettingsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('yash:settings-changed', handleSettingsChanged);
    };
  }, []);
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
  const [ffzEmotes, setFfzEmotes] = useState<Record<string, FfzEmoteDefinition>>({});
  const ffzEmotesRef = useRef<Record<string, FfzEmoteDefinition>>({});

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
          newLastError[platform] =
            (error instanceof Error ? error.message : null) || 'Unknown error';
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
    const updateMessages = async () => {
      const msgs = await getChatMessages();
      setMessages(msgs);
    };

    const interval = setInterval(updateMessages, 2000);
    updateMessages();

    return () => clearInterval(interval);
  }, [getChatMessages]);

  useEffect(() => {
    ffzEmotesRef.current = ffzEmotes;
  }, [ffzEmotes]);

  useEffect(() => {
    let cancelled = false;

    const loadFfzEmotes = async () => {
      try {
        const res = await fetch('/api/twitch/ffz-emotes');
        if (!res.ok) return;
        const data = (await res.json()) as {
          emotes?: Record<string, FfzEmoteDefinition>;
        };
        if (!cancelled) {
          setFfzEmotes(data.emotes ?? {});
        }
      } catch {}
    };

    void loadFfzEmotes();
    const retryInterval = setInterval(() => {
      if (Object.keys(ffzEmotesRef.current).length > 0) return;
      void loadFfzEmotes();
    }, FFZ_RETRY_INTERVAL_MS);
    const refreshInterval = setInterval(() => {
      void loadFfzEmotes();
    }, FFZ_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(retryInterval);
      clearInterval(refreshInterval);
    };
  }, []);

  const handleUpdateMetadata = async (metadata: StreamMetadata) => {
    await onUpdateMetadata(selectedPlatforms, metadata);
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

  const btnStyle: React.CSSProperties = {
    color: '#fff',
    border: 'none',
    padding: '4px 8px',
    cursor: 'pointer',
    borderRadius: '3px',
  };

  const toggleChatTimestamps = async () => {
    const next = !showChatTimestamps;
    setShowChatTimestamps(next);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'chat.timestamps.visible', value: next }),
      });

      if (!res.ok) {
        setShowChatTimestamps(!next);
      }
    } catch {
      setShowChatTimestamps(!next);
    }
  };

  return (
    <div style={{ padding: '8px', backgroundColor: '#0f0f1a' }}>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 'bold', color: '#06b6d4', fontSize: '1.5em' }}>
              YASH - Yet Another Streamer Helper
            </span>
            <br />
            <span style={{ color: '#6b7280' }}>
              Unified platform management for YouTube, Twitch, and Kick
            </span>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              style={{ ...btnStyle, backgroundColor: '#333' }}
            >
              {showSettings ? 'Close Settings' : 'Settings'}
            </button>
          </div>
        </div>
        {showSettings && (
          <div
            style={{
              marginTop: '8px',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '8px',
              width: '50%',
            }}
          >
            <span style={{ fontWeight: 'bold' }}>UI Settings</span>
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                flexDirection: 'row',
                gap: '8px',
                alignItems: 'center',
              }}
            >
              <button
                type="button"
                onClick={() => setShowPlatformStatus((v) => !v)}
                style={{
                  ...btnStyle,
                  backgroundColor: showPlatformStatus ? '#22c55e' : '#333',
                }}
              >
                {showPlatformStatus ? '[x] Show Platform Status' : '[ ] Show Platform Status'}
              </button>
              <button
                type="button"
                onClick={() => void toggleChatTimestamps()}
                style={{
                  ...btnStyle,
                  backgroundColor: showChatTimestamps ? '#22c55e' : '#333',
                }}
              >
                {showChatTimestamps ? '[x] Show Chat Timestamps' : '[ ] Show Chat Timestamps'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '50%' }}>
          <StreamControls
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            onSelectPlatforms={setSelectedPlatforms}
            onUpdateMetadata={handleUpdateMetadata}
            getStreamStatus={getStreamStatusFn}
          />

          {showPlatformStatus && (
            <StatusBar platformStatus={combinedPlatformStatus} obsConnected={obsConnected} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '50%' }}>
          <div
            style={{
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '8px',
              backgroundColor: '#1a1a2e',
            }}
          >
            <div style={{ marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold' }}>Unified Chat</span>
            </div>
            <ChatDisplay
              messages={messages}
              ffzEmotes={ffzEmotes}
              showTimestamps={showChatTimestamps}
            />
          </div>

          <MessageInput
            platforms={platforms}
            selectedPlatforms={selectedPlatforms}
            sendToAll={sendToAll}
            onToggleSendToAll={setSendToAll}
            onSelectPlatforms={setSelectedPlatforms}
            onSendMessage={onSendMessage}
            placeholder="Type a message..."
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
