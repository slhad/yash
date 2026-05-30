/** @jsxImportSource react */
import React, { useRef, useState } from 'react';
import { getWebAutocomplete } from '../utils/webCommands';

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

const MAX_SENT_HISTORY = 100;
const MESSAGE_HISTORY_STORAGE_KEY = 'yash_web_message_history';

function loadStoredMessageHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(MESSAGE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-MAX_SENT_HISTORY);
  } catch {
    return [];
  }
}

function saveStoredMessageHistory(entries: string[]): void {
  try {
    window.localStorage.setItem(
      MESSAGE_HISTORY_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_SENT_HISTORY)),
    );
  } catch {}
}

export const MessageInput: React.FC<MessageInputProps> = ({
  onSendMessage,
  platforms,
  selectedPlatforms,
  sendToAll,
  onToggleSendToAll,
  onSelectPlatforms,
  placeholder = 'Type a message or /help for commands…',
}) => {
  const [message, setMessage] = useState('');
  const historyRef = useRef<string[]>(loadStoredMessageHistory());
  const historyIdxRef = useRef(-1);
  const draftBeforeHistoryRef = useRef('');

  const hint = getWebAutocomplete(message);

  const handleSend = async () => {
    if (message.trim()) {
      historyRef.current.push(message.trim());
      if (historyRef.current.length > MAX_SENT_HISTORY) {
        historyRef.current.splice(0, historyRef.current.length - MAX_SENT_HISTORY);
      }
      saveStoredMessageHistory(historyRef.current);
      historyIdxRef.current = -1;
      draftBeforeHistoryRef.current = '';
      await onSendMessage(message, sendToAll ? [] : selectedPlatforms);
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const history = historyRef.current;
      if (history.length === 0) return;
      if (historyIdxRef.current === -1) {
        draftBeforeHistoryRef.current = message;
        historyIdxRef.current = history.length - 1;
      } else if (historyIdxRef.current > 0) historyIdxRef.current--;
      setMessage(history[historyIdxRef.current] ?? '');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const history = historyRef.current;
      if (historyIdxRef.current === -1) return;
      historyIdxRef.current++;
      if (historyIdxRef.current >= history.length) {
        historyIdxRef.current = -1;
        setMessage(draftBeforeHistoryRef.current);
      } else {
        setMessage(history[historyIdxRef.current] ?? '');
      }
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
        onChange={(e) => {
          historyIdxRef.current = -1;
          draftBeforeHistoryRef.current = '';
          setMessage(e.target.value);
        }}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
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

      {hint && (
        <div
          style={{
            marginTop: '2px',
            fontSize: '11px',
            color: '#6a8aaa',
            fontFamily: 'monospace',
          }}
        >
          {hint}
        </div>
      )}

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
