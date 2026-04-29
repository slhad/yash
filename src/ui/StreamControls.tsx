/** @jsxImportSource react */
import React, { useEffect, useRef, useState } from 'react';
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
  twitchGame: string;
  kickCategory: string;
  youtubeCategory: string;
}

interface StreamControlsProps {
  platforms: string[];
  selectedPlatforms: string[];
  onSelectPlatforms: (platforms: string[]) => void;
  onUpdateMetadata: (metadata: StreamMetadata) => Promise<void>;
  getStreamStatus: (platform: string) => string;
}

export const StreamControls: React.FC<StreamControlsProps> = ({
  platforms,
  selectedPlatforms,
  onSelectPlatforms,
  onUpdateMetadata,
  getStreamStatus,
}) => {
  const [streamTitle, setStreamTitle] = useState('');
  const [streamGame, setStreamGame] = useState('');
  const [streamDescription, setStreamDescription] = useState('');
  const [streamTags, setStreamTags] = useState('');
  const [streamNotification, setStreamNotification] = useState('');
  const [twitchGame, setTwitchGame] = useState('');
  const [kickCategory, setKickCategory] = useState('');
  const [youtubeCategory, setYoutubeCategory] = useState('');
  const [savedMeta, setSavedMeta] = useState<Record<string, any>>({});
  const [isProcessing, setIsProcessing] = useState(false);

  const [twitchCatSuggestions, setTwitchCatSuggestions] = useState<string[]>([]);
  const [kickCatSuggestions, setKickCatSuggestions] = useState<string[]>([]);
  const [ytCategories, setYtCategories] = useState<string[]>([]);

  const twitchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kickDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted stream info on mount
  useEffect(() => {
    fetch('/api/stream')
      .then((r) => r.json())
      .then((meta) => {
        setSavedMeta(meta);
        setStreamTitle(meta.title ?? '');
        setStreamGame(meta.game ?? '');
        setStreamDescription(meta.description ?? '');
        setStreamTags(Array.isArray(meta.tags) ? meta.tags.join(', ') : (meta.tags ?? ''));
        setStreamNotification(meta.notification ?? '');
        setTwitchGame(meta.twitchGame ?? '');
        setKickCategory(meta.kickCategory ?? '');
        setYoutubeCategory(meta.youtubeCategory ?? '');
      })
      .catch(() => {});
  }, []);

  // Fetch YouTube categories on mount
  useEffect(() => {
    fetch('/api/youtube/categories')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.categories)) {
          setYtCategories(data.categories);
        }
      })
      .catch(() => {});
  }, []);

  const fetchTwitchSuggestions = (q: string) => {
    if (twitchDebounceRef.current) clearTimeout(twitchDebounceRef.current);
    twitchDebounceRef.current = setTimeout(() => {
      fetch(`/api/twitch/categories?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.categories)) {
            setTwitchCatSuggestions(data.categories);
          }
        })
        .catch(() => {});
    }, 300);
  };

  const fetchKickSuggestions = (q: string) => {
    if (kickDebounceRef.current) clearTimeout(kickDebounceRef.current);
    kickDebounceRef.current = setTimeout(() => {
      fetch(`/api/kick/categories?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data.categories)) {
            setKickCatSuggestions(data.categories);
          }
        })
        .catch(() => {});
    }, 300);
  };

  const currentMetadata = (): StreamMetadata => ({
    title: streamTitle,
    description: streamDescription,
    tags: streamTags,
    game: streamGame,
    notification: streamNotification,
    twitchGame,
    kickCategory,
    youtubeCategory,
  });

  const hasChanges = (): boolean => {
    const cur = currentMetadata();
    const curTags = cur.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const savedTags = Array.isArray(savedMeta.tags)
      ? savedMeta.tags
      : (savedMeta.tags ?? '')
          .split(',')
          .map((t: string) => t.trim())
          .filter(Boolean);
    return (
      cur.title !== (savedMeta.title ?? '') ||
      cur.game !== (savedMeta.game ?? '') ||
      cur.description !== (savedMeta.description ?? '') ||
      cur.notification !== (savedMeta.notification ?? '') ||
      cur.twitchGame !== (savedMeta.twitchGame ?? '') ||
      cur.kickCategory !== (savedMeta.kickCategory ?? '') ||
      cur.youtubeCategory !== (savedMeta.youtubeCategory ?? '') ||
      JSON.stringify(curTags) !== JSON.stringify(savedTags)
    );
  };

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

  const handleUpdate = async () => {
    setIsProcessing(true);
    try {
      await onUpdateMetadata(currentMetadata());
      setSavedMeta({ ...savedMeta, ...currentMetadata() });
    } catch (error) {
      defaultLogger.error('Failed to update stream metadata:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const hasPlatformSpecificCat =
    selectedPlatforms.includes('twitch') ||
    selectedPlatforms.includes('kick') ||
    selectedPlatforms.includes('youtube');

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
        <span style={{ fontWeight: 'bold' }}>Stream Info</span>
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
        <span style={{ marginLeft: '8px', color: anyOnline ? '#22c55e' : '#6b7280' }}>
          {anyOnline ? '● LIVE' : '○ Offline'}
        </span>
      </div>

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

        {selectedPlatforms.includes('twitch') && (
          <div>
            <label style={labelStyle}>Category (Twitch)</label>
            <input
              type="text"
              value={twitchGame}
              onChange={(e) => {
                setTwitchGame(e.target.value);
                fetchTwitchSuggestions(e.target.value);
              }}
              placeholder="Game or category"
              list="twitch-cats"
              style={inputStyle}
            />
            <datalist id="twitch-cats">
              {twitchCatSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        )}

        {selectedPlatforms.includes('kick') && (
          <div>
            <label style={labelStyle}>Category (Kick)</label>
            <input
              type="text"
              value={kickCategory}
              onChange={(e) => {
                setKickCategory(e.target.value);
                fetchKickSuggestions(e.target.value);
              }}
              placeholder="Game or category"
              list="kick-cats"
              style={inputStyle}
            />
            <datalist id="kick-cats">
              {kickCatSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        )}

        {selectedPlatforms.includes('youtube') && (
          <div>
            <label style={labelStyle}>Category (YouTube)</label>
            <select
              value={youtubeCategory}
              onChange={(e) => setYoutubeCategory(e.target.value)}
              style={{ ...inputStyle }}
            >
              <option value="">-- Select category --</option>
              {ytCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        )}

        {!hasPlatformSpecificCat && (
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
        )}

        {hasPlatformSpecificCat && (
          <div>
            <label style={labelStyle}>Title Suffix / Subject</label>
            <input
              type="text"
              value={streamGame}
              onChange={(e) => setStreamGame(e.target.value)}
              placeholder="Shared subject / fallback category"
              style={inputStyle}
            />
          </div>
        )}

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

      <div style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={selectedPlatforms.length === 0 || isProcessing || !hasChanges()}
          style={{
            ...btnStyle,
            backgroundColor: '#3b82f6',
            opacity: selectedPlatforms.length === 0 || isProcessing || !hasChanges() ? 0.5 : 1,
          }}
        >
          Update
        </button>
      </div>
    </div>
  );
};
