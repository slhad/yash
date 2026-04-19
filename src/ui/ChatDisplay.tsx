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
        return '#ef4444';
      case 'twitch':
        return '#a855f7';
      case 'kick':
        return '#22c55e';
      default:
        return '#ffffff';
    }
  };

  return (
    <div
      style={{
        border: '1px solid #444',
        borderRadius: '4px',
        padding: '8px',
        height: '320px',
        backgroundColor: '#1a1a2e',
      }}
    >
      <div style={{ height: '100%', overflowY: 'auto' }}>
        {messages.length === 0 ? (
          <span style={{ color: '#6b7280' }}>No messages yet...</span>
        ) : (
          messages.map((msg) => (
            <div key={msg.id}>
              <span>
                {showTimestamps && (
                  <span style={{ color: '#6b7280' }}>[{formatTime(msg.timestamp)}] </span>
                )}
                <span style={{ color: getPlatformColor(msg.platform), fontWeight: 'bold' }}>
                  [{msg.platform}]
                </span>{' '}
                <span style={{ color: '#06b6d4' }}>{msg.username}:</span> {msg.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
