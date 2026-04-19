import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './ui/Dashboard';

const platforms = ['youtube', 'twitch', 'kick'];

function App() {
  const [platformStatus, setPlatformStatus] = useState<Record<string, any>>({});
  const [obsConnected, setObsConnected] = useState(false);

  // Poll /api/status for platform and OBS status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          setPlatformStatus(data);
        }
      } catch {}
      try {
        const res = await fetch('/api/obs/status');
        if (res.ok) {
          const data = await res.json();
          setObsConnected(!!data.connected);
        }
      } catch {}
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, []);

  const handleAuthenticate = async (_platform: string) => {
    // Authentication is managed server-side; no-op in browser
  };

  const handleStartStream = async (targets: string[], metadata: any) => {
    await fetch('/api/stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platforms: targets, metadata }),
    });
  };

  const handleStopStream = async (targets: string[]) => {
    await fetch('/api/stream/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platforms: targets }),
    });
  };

  const handleUpdateMetadata = async (targets: string[], metadata: any) => {
    await fetch('/api/stream/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platforms: targets, metadata }),
    });
  };

  const handleSendMessage = async (message: string, targetPlatforms: string[]) => {
    await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, platforms: targetPlatforms }),
    });
  };

  const getPlatformStatus = useCallback(
    (platform: string) =>
      platformStatus[platform] ?? {
        authenticated: false,
        streamStatus: 'OFFLINE',
        connectionStatus: 'disconnected',
        lastError: null,
      },
    [platformStatus],
  );

  const getObsStatus = useCallback(() => obsConnected, [obsConnected]);

  const getChatMessages = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/history');
      if (res.ok) return await res.json();
    } catch {}
    return [];
  }, []);

  return (
    <Dashboard
      platforms={platforms}
      onAuthenticate={handleAuthenticate}
      onStartStream={handleStartStream}
      onStopStream={handleStopStream}
      onUpdateMetadata={handleUpdateMetadata}
      onSendMessage={handleSendMessage}
      getPlatformStatus={getPlatformStatus}
      getObsStatus={getObsStatus}
      getChatMessages={getChatMessages}
    />
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
