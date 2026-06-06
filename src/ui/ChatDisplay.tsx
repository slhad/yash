/** @jsxImportSource react */
import React from 'react';
import { type FfzEmoteDefinition, parseMessageWithFfzEmotes } from '../utils/ffz';

interface ChatDisplayProps {
  messages: Array<{
    id: string;
    platform: string;
    username: string;
    message: string;
    timestamp: number;
    badges?: Record<string, string>;
    profileImageUrl?: string | null;
  }>;
  ffzEmotes?: Record<string, FfzEmoteDefinition>;
  showTimestamps?: boolean;
}

export const ChatDisplay: React.FC<ChatDisplayProps> = ({
  messages,
  ffzEmotes = {},
  showTimestamps = true,
}) => {
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

  const renderMessage = (platform: string, message: string) => {
    if (platform !== 'twitch') {
      return message;
    }

    let cursor = 0;
    return parseMessageWithFfzEmotes(message, ffzEmotes).map((part) => {
      const keyBase =
        part.type === 'text'
          ? `text-${cursor}-${part.content}`
          : `emote-${cursor}-${part.emote.name}-${part.emote.url}`;

      if (part.type === 'text') {
        cursor += part.content.length;
        return <React.Fragment key={keyBase}>{part.content}</React.Fragment>;
      }
      cursor += part.emote.name.length;
      return (
        <img
          key={keyBase}
          className="emote-inline emote-inline-ffz"
          alt={part.emote.name}
          title={part.emote.name}
          loading="lazy"
          decoding="async"
          src={part.emote.url}
          width={part.emote.width}
          height={part.emote.height}
        />
      );
    });
  };

  const renderBadges = (badges?: Record<string, string>) => {
    if (!badges || Object.keys(badges).length === 0) return null;
    return Object.entries(badges).map(([name, value]) => (
      <span
        key={`${name}:${value}`}
        title={value ? `${name} (${value})` : name}
        style={{
          display: 'inline-block',
          marginRight: '4px',
          padding: '1px 6px',
          borderRadius: '999px',
          backgroundColor: '#2d3748',
          color: '#cbd5e1',
          fontSize: '11px',
          lineHeight: 1.5,
        }}
      >
        {value && value !== '1' ? `${name}:${value}` : name}
      </span>
    ));
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
            <div
              key={msg.id}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}
            >
              {msg.profileImageUrl ? (
                <img
                  src={msg.profileImageUrl}
                  alt={`${msg.username} avatar`}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '999px',
                    objectFit: 'cover',
                    backgroundColor: '#0f172a',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '999px',
                    backgroundColor: '#273449',
                    flexShrink: 0,
                  }}
                />
              )}
              <span style={{ minWidth: 0 }}>
                {showTimestamps && (
                  <span style={{ color: '#6b7280' }}>[{formatTime(msg.timestamp)}] </span>
                )}
                <span style={{ color: getPlatformColor(msg.platform), fontWeight: 'bold' }}>
                  [{msg.platform}]
                </span>{' '}
                {renderBadges(msg.badges)}
                <span style={{ color: '#06b6d4' }}>{msg.username}:</span>{' '}
                {renderMessage(msg.platform, msg.message)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
