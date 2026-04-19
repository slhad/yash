import React, { useState } from 'react';
import { defaultLogger } from '../utils/logger';

const btnStyle: React.CSSProperties = {
  color: '#fff',
  border: 'none',
  padding: '4px 8px',
  cursor: 'pointer',
  borderRadius: '3px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  backgroundColor: '#0f0f1a',
  color: '#fff',
  border: '1px solid #444',
  borderRadius: '3px',
  padding: '4px 8px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '2px',
  color: '#aaa',
  fontSize: '0.85em',
};

export interface StreamMetadata {
  title: string;
  description: string;
  tags: string;
  game: string;
  notification: string;
}

interface StreamControlsProps {
  platforms: string[];
  selectedPlatforms: string[];
  onSelectPlatforms: (platforms: string[]) => void;
  onStartStream: (metadata: StreamMetadata) => Promise<void>;
  onStopStream: () => Promise<void>;
  onUpdateMetadata: (metadata: StreamMetadata) => Promise<void>;
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
  const [streamDescription, setStreamDescription] = useState('');
  const [streamTags, setStreamTags] = useState('');
  const [streamNotification, setStreamNotification] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const currentMetadata = (): StreamMetadata => ({
    title: streamTitle,
    description: streamDescription,
    tags: streamTags,
    game: streamGame,
    notification: streamNotification,
  });

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
      await onStartStream(currentMetadata());
    } catch (error) {
      defaultLogger.error('Failed to start stream:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStop = async () => {
    setIsProcessing(true);
    try {
      await onStopStream();
    } catch (error) {
      defaultLogger.error('Failed to stop stream:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdate = async () => {
    setIsProcessing(true);
    try {
      await onUpdateMetadata(currentMetadata());
    } catch (error) {
      defaultLogger.error('Failed to update metadata:', error);
    } finally {
      setIsProcessing(false);
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
        <span style={{ fontWeight: 'bold' }}>Stream Controls</span>
      </div>

      <div
        style={{
          marginBottom: '8px',
          display: 'flex',
          flexDirection: 'row',
          gap: '4px',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={toggleAll}
          style={{
            ...btnStyle,
            backgroundColor: selectedPlatforms.length === platforms.length ? '#3b82f6' : '#333',
          }}
        >
          {selectedPlatforms.length === platforms.length ? '[x] All' : '[ ] All'}
        </button>
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

      <div style={{ marginBottom: '8px' }}>
        <span>
          {anyOnline ? (
            <span style={{ color: '#22c55e' }}>● LIVE</span>
          ) : (
            <span style={{ color: '#6b7280' }}>○ Offline</span>
          )}
        </span>
        <span style={{ color: '#6b7280' }}>
          {' '}
          {selectedPlatforms.length > 0 ? `${selectedPlatforms.length} selected` : 'None selected'}
        </span>
      </div>

      {!anyOnline && (
        <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div>
            <label style={labelStyle}>Title</label>
            <input
              type="text"
              value={streamTitle}
              onChange={(e) => setStreamTitle(e.target.value)}
              placeholder="Stream title (all platforms)"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Subject / Category / Game</label>
            <input
              type="text"
              value={streamGame}
              onChange={(e) => setStreamGame(e.target.value)}
              placeholder="Game or category (all platforms)"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input
              type="text"
              value={streamTags}
              onChange={(e) => setStreamTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
              style={inputStyle}
            />
          </div>
          {selectedPlatforms.includes('youtube') && (
            <div>
              <label style={labelStyle}>Description (YouTube)</label>
              <textarea
                value={streamDescription}
                onChange={(e) => setStreamDescription(e.target.value)}
                placeholder="Stream description"
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          )}
          {selectedPlatforms.includes('twitch') && (
            <div>
              <label style={labelStyle}>Notification (Twitch)</label>
              <input
                type="text"
                value={streamNotification}
                onChange={(e) => setStreamNotification(e.target.value)}
                placeholder="Going live notification message"
                style={inputStyle}
              />
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
        <button
          type="button"
          onClick={anyOnline ? handleStop : handleStart}
          disabled={selectedPlatforms.length === 0 || isProcessing}
          style={{
            ...btnStyle,
            backgroundColor: anyOnline ? '#ef4444' : '#22c55e',
            opacity: selectedPlatforms.length === 0 || isProcessing ? 0.5 : 1,
          }}
        >
          {anyOnline ? 'Stop' : 'Start'}
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={!anyOnline || isProcessing}
          style={{
            ...btnStyle,
            backgroundColor: '#eab308',
            opacity: !anyOnline || isProcessing ? 0.5 : 1,
          }}
        >
          Update
        </button>
      </div>
    </div>
  );
};
