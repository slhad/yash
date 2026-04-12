import React, { useState } from 'react';

// MessageInput component for sending messages
interface MessageInputProps {
  onSendMessage: (message: string, targetPlatforms: string[]) => void;
  availablePlatforms: string[];
  placeholder?: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  availablePlatforms,
  placeholder = 'Type a message...',
}) => {
  const [message, setMessage] = useState('');
  const [targetPlatforms, setTargetPlatforms] = useState<string[]>([]);
  const [sendToAll, setSendToAll] = useState(true);

  const handleSend = async () => {
    if (message.trim()) {
      await onSendMessage(message, sendToAll ? [] : targetPlatforms);
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="message-input-container">
      <div className="input-controls">
        <label>
          <input
            type="checkbox"
            checked={sendToAll}
            onChange={(e) => {
              setSendToAll(e.target.checked);
              if (e.target.checked) {
                setTargetPlatforms([]);
              }
            }}
          />
          Send to All Platforms
        </label>

        {!sendToAll && availablePlatforms.length > 0 && (
          <div className="platform-selector">
            <label>Send to:</label>
            <select
              multiple
              value={targetPlatforms}
              onChange={(e) => {
                setTargetPlatforms(
                  Array.from(e.target.selectedOptions).map((option) => option.value),
                );
              }}
            >
              {availablePlatforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        className="message-textarea"
      />

      <div className="input-actions">
        <button onClick={handleSend} className="send-button">
          Send
        </button>
      </div>
    </div>
  );
};

// In a real implementation with OpenTUI, this would use their components
// For example:
// import { Box, Text, Textarea, Button, Checkbox, Select } from '@opentui/components';
//
// export const MessageInput: React.FC<MessageInputProps> = ({
//   onSendMessage,
//   availablePlatforms,
//   placeholder
// }) => {
//   // Implementation using OpenTUI components
// };
