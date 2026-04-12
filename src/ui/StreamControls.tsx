import React, { useState } from 'react';

// StreamControls component for managing stream operations
interface StreamControlsProps {
  onStartStream: (platforms: string[], metadata: any) => Promise<void>;
  onStopStream: (platforms: string[]) => Promise<void>;
  onUpdateMetadata: (platforms: string[], metadata: any) => Promise<void>;
  getStreamStatus: (platform: string) => string; // Returns StreamStatus as string
  availablePlatforms: string[];
}

export const StreamControls: React.FC<StreamControlsProps> = ({
  onStartStream,
  onStopStream,
  onUpdateMetadata,
  getStreamStatus,
  availablePlatforms,
}) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [streamTitle, setStreamTitle] = useState('');
  const [streamGame, setStreamGame] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Determine if any selected platform is currently streaming
  const anyPlatformStreaming = selectedPlatforms.some(
    (platform) => getStreamStatus(platform) === 'ONLINE',
  );

  const handleStartStream = async () => {
    try {
      setIsStreaming(true);
      await onStartStream(selectedPlatforms, {
        title: streamTitle || 'Untitled Stream',
        game: streamGame || '',
      });
    } catch (error) {
      console.error('Failed to start stream:', error);
      // In a real app, we'd show an error notification
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStopStream = async () => {
    try {
      setIsStreaming(true);
      await onStopStream(selectedPlatforms);
    } catch (error) {
      console.error('Failed to stop stream:', error);
      // In a real app, we'd show an error notification
    } finally {
      setIsStreaming(false);
    }
  };

  const handleUpdateMetadata = async () => {
    try {
      await onUpdateMetadata(selectedPlatforms, {
        title: streamTitle || 'Untitled Stream',
        game: streamGame || '',
      });
      // In a real app, we'd show a success notification
    } catch (error) {
      console.error('Failed to update stream metadata:', error);
      // In a real app, we'd show an error notification
    }
  };

  return (
    <div className="stream-controls">
      <div className="controls-header">
        <h3>Stream Controls</h3>
        <div className="platform-selection">
          <label>
            <input
              type="checkbox"
              checked={selectedPlatforms.length === availablePlatforms.length}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedPlatforms([...availablePlatforms]);
                } else {
                  setSelectedPlatforms([]);
                }
              }}
            />
            Select All Platforms
          </label>

          {availablePlatforms.length > 1 && (
            <div className="individual-platforms">
              {availablePlatforms.map((platform) => (
                <label key={platform}>
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(platform)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPlatforms([...selectedPlatforms, platform]);
                      } else {
                        setSelectedPlatforms(selectedPlatforms.filter((p) => p !== platform));
                      }
                    }}
                  />
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="stream-status">
        {anyPlatformStreaming ? (
          <span className="status-indicator streaming">● Live</span>
        ) : (
          <span className="status-indicator offline">● Offline</span>
        )}
        <span className="status-text">
          {selectedPlatforms.length > 0
            ? `${selectedPlatforms.length} platform${selectedPlatforms.length > 1 ? 's' : ''} selected`
            : 'No platforms selected'}
        </span>
      </div>

      {!anyPlatformStreaming && (
        <div className="stream-metadata">
          <div className="form-group">
            <label>Stream Title:</label>
            <input
              type="text"
              value={streamTitle}
              onChange={(e) => setStreamTitle(e.target.value)}
              placeholder="Enter stream title"
              className="metadata-input"
            />
          </div>

          <div className="form-group">
            <label>Game/Category:</label>
            <input
              type="text"
              value={streamGame}
              onChange={(e) => setStreamGame(e.target.value)}
              placeholder="Enter game or category"
              className="metadata-input"
            />
          </div>
        </div>
      )}

      <div className="control-buttons">
        <button
          onClick={handleStartStream}
          disabled={selectedPlatforms.length === 0 || isStreaming}
          className={`${anyPlatformStreaming ? 'stop-button' : 'start-button'} control-button`}
        >
          {anyPlatformStreaming ? 'Stop Stream' : 'Start Stream'}
        </button>

        <button
          onClick={handleUpdateMetadata}
          disabled={selectedPlatforms.length === 0 || isStreaming || !anyPlatformStreaming}
          className="update-button control-button"
        >
          Update Info
        </button>
      </div>
    </div>
  );
};

// In a real implementation with OpenTUI, this would use their components
// For example:
// import { Box, Text, Input, Button, Checkbox, Label } from '@opentui/components';
//
// export const StreamControls: React.FC<StreamControlsProps> = ({ ... }) => {
//   // Implementation using OpenTUI components
// };
