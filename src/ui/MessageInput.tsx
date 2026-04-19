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

const btnStyle: React.CSSProperties = {
  color: '#fff',
  border: 'none',
  padding: '4px 8px',
  cursor: 'pointer',
  borderRadius: '3px',
};

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
    <div
      style={{
        border: '1px solid #444',
        borderRadius: '4px',
        padding: '8px',
        backgroundColor: '#1a1a2e',
      }}
    >
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontWeight: 'bold' }}>Send Message</span>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => onToggleSendToAll(!sendToAll)}
          style={{ ...btnStyle, backgroundColor: sendToAll ? '#22c55e' : '#333' }}
        >
          {sendToAll ? '[x] Send to All' : '[ ] Send to All'}
        </button>
      </div>

      {!sendToAll && platforms.length > 0 && (
        <div
          style={{
            marginBottom: '8px',
            display: 'flex',
            flexDirection: 'row',
            gap: '4px',
            alignItems: 'center',
          }}
        >
          <span>Send to:</span>
          {platforms.map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => togglePlatform(platform)}
              style={{
                ...btnStyle,
                backgroundColor: selectedPlatforms.includes(platform) ? '#3b82f6' : '#333',
              }}
            >
              {selectedPlatforms.includes(platform) ? '[x]' : '[ ]'}{' '}
              {platform.charAt(0).toUpperCase() + platform.slice(1)}
            </button>
          ))}
        </div>
      )}

      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSend();
        }}
        style={{
          width: '100%',
          backgroundColor: '#0f0f1a',
          color: '#fff',
          border: '1px solid #444',
          borderRadius: '3px',
          padding: '4px 8px',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ marginTop: '8px' }}>
        <button
          type="button"
          onClick={handleSend}
          style={{ ...btnStyle, backgroundColor: '#3b82f6' }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
