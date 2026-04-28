# Specifications

## Project Overview
Yet Another Streamer Helper (YASH) is a unified platform manager for YouTube, Twitch, and Kick streaming services that handles authentication, communication, and stream management with a standardized interface.

## Goals
- Usable TUI
    * Command /settings to configure display of UI elements etc...
        * Element : Number of viewers
            * displayed: on/off
            * mode: per platform/cumulative/both
        * Window (as sidebar) showing events/triggers/stuff with platform prefix (if more than one)
        * Window showing messages with platform as header (if more than one)
        * Window showing all messages with platform as prefix (if more than one)
        * Element : Platform connected as Status bar — single borderless line starting with "Status" label, each platform shown as `platform: STATUS (viewers)` in green (authenticated) or red (not authenticated); viewer count `(x)` only shown when platform is ONLINE, `viewers.visible` setting is true (default), and per-platform `showViewers` is not false in `config.json`
        * Message box
            * position : top/bottom/hide
        * Element : Title (YASH heading)
            * visible: true/false (default: false, toggle with `/settings set title.visible true`)
    * Command /connect [youtube|twitch|kick] to launch connection to platform with auth+save secrets in config
    * Command /exit - exits the application cleanly (TUI only)
    * Command /help - lists all available commands
    * Command /logs [clear|tail <n>|visible <true|false>] - manage log display (TUI only)
    * Command /msg <all|youtube|twitch|kick> <text> - sends a message to the specified platform(s)
    * Command /marker [description] [| timestamp_s] - places a stream marker on all platforms
        * Optional description (chapter label, max 140 chars on Twitch)
        * Optional pipe-delimited timestamp in seconds from stream start (used by YouTube for chapter generation; ignored by Twitch which sets position server-side; Kick does not support markers)
        * Examples: `/marker Intro | 0`, `/marker Q&A | 3723`, `/marker` (unnamed, no timestamp)
    * Command /settings [get <key>|set <key> <value>] - get or set UI settings
    * Message box to send message to [all|youtube|twitch|kick] platform and receive command "/" (without sending to platforms)
        * Input history: Up/Down arrow keys navigate previously-sent messages (like a shell history)
        * Command parameter autocomplete: after typing a command + space, Tab completes available parameters
            * `/connect ` → `youtube | twitch | kick`
            * `/msg ` → `all | youtube | twitch | kick`
            * `/settings ` → `get | set`; `/settings get/set ` → setting key list
            * `/logs ` → `clear | tail | visible`
        * Single-match autocomplete on Enter: if only one command or argument matches the current input, pressing Enter executes that completion directly without needing Tab first
    * TUI Layout
        * Single-line borderless status bar showing all platforms + OBS connection status on one horizontal row; stream status color-coded per platform
        * Chat panel occupies center/maximum space (flex-grow), horizontal layout with right sidebar
        * Events and logs merged into a single "Events & Logs" right sidebar panel
        * Message input box always visible with border/title, rendered before typing begins
- Usable webviews
    * Route / to show controls of the app and stream setup info
        * Title (youtube,twitch,kick)
        * Description (youtube)
        * Notification (twitch)
        * Tags (youtube,twitch,kick)
        * Subject/Category/Game (youtube,twitch,kick)
    * Route /unified to show unified view of all chats
        * Message box supports all applicable / commands: `/help`, `/msg`, `/marker`, `/connect`, `/settings`
    * Route /sidebyside to show view of chats side by side with config options to enable any platform (saved in browser)
        * Message box supports all applicable / commands: `/help`, `/msg`, `/marker`, `/connect`, `/settings`
    * All chats view must have a message box to send messages like TUI, display top/bottom/hide (saved in browser individually)
        * Input history: Up/Down arrow keys navigate previously-sent messages
        * Inline parameter hints while typing a `/` command (shows valid next tokens below input)
    * WebUI commands available in all chat message boxes (`/`, `/unified`, `/sidebyside`):
        * `/help` — list available commands (fetched from `/api/help`)
        * `/msg <all|youtube|twitch|kick> <text>` — send targeted platform message
        * `/marker [description] [| timestamp_s]` — create stream marker on all (or selected) platforms
        * `/connect <youtube|twitch|kick>` — authenticate a platform (all three redirect to real OAuth flows)
        * `/settings get <key>` — read a persistent setting via `/api/settings`
        * `/settings set <key> <value>` — write a persistent setting via `/api/settings`
    * TUI-only commands (not available in WebUI): `/exit`, `/logs`

## Out of scope (do not touch)
- Contributing
- Secrets security (encryption at rest, key rotation, OS keyring integration)
- OS keyring integration (keytar) and related token migration scripts
- Encrypted token storage and encryption-based admin key export/import (hybrid RSA+AES packages)
- Admin endpoints that perform encryption/key export/import or rotation (e.g., /api/admin/rotate-key, /api/admin/export-key, /api/admin/keys/import)
- Repository pre-commit hook installer and .githooks management (pre-commit hook installer scripts)
- Any feature that depends on native keyring binaries or OS-specific keyring modules
- Automatic migration/backup tooling for encrypted secrets
- manifest/checksum generation, signing and verification, ownership remediation

## Deliverables
* Screenshots of webviews made with playwright
* Gif of TUI made with VHS

## Technical Requirements

### Runtime and Testing
- Must use [Bun](https://bun.sh) as the runtime and test runner (`bun run`, `bun test`)

### Linting and Formatting
- Must use [Biome](https://biomejs.dev) for linting and formatting (`biome check --write`)

### UI Components
- Must use https://github.com/anomalyco/opentui for UI components in terminal

### Logging
- All log output is written to both stderr (console) and `~/.yash/yash.log` (file transport)
- The file always includes an ISO 8601 timestamp even when the console formatter omits it
- Log file is rotated when it exceeds 10 MB (renamed to `yash.log.1`); data directory defaults to `~/.yash` and can be overridden via `YASH_DATA_DIR`

### Architecture
- Provider abstraction layer with common `PlatformProvider` interface
- Individual implementations for YouTube, Twitch, and Kick platforms
- Modular service layer (AuthService, ChatService, StreamService, ObsService)
- Event-driven architecture for real-time communication
- Token storage for authentication credentials (file-backed). Encryption/keyring-based storage is considered out of scope for this build.
- OBS-studio integration via obs-websocket library
- Configuration is stored in [root]/config.json
- TUI and web server run as a single process (`bun run src/index.tsx`); `index.tsx` imports `index.ts` as a side-effect to start `Bun.serve` in the same process. Running them as separate processes causes port 3000 conflicts.
- `Bun.serve` must use `development: false`. In development mode, Bun writes HTML bundle timing lines (e.g. `Bundled page in 31ms: index.html`) directly to fd 1 via native I/O, bypassing both `process.stdout` and the JS `console.*` API. Since `@opentui` renders the TUI on that same fd, these writes bleed into the TUI display and cannot be intercepted at the JS level. `development: false` suppresses this output; HMR is intentionally disabled as a result.

### Platform Support
- YouTube: Real OAuth2 integration via Google Data API v3
    * OAuth2 Authorization Code flow; tokens persisted to `~/.yash/youtube_tokens.json`; access token auto-refreshed before expiry
    * `getAuthUrl()` / `handleOAuthCallback(code)` — browser-based consent flow; callback at `GET /api/youtube/callback`
    * `updateStreamMetadata()` — updates live broadcast title/description via `liveBroadcasts.update` (GET + PUT to preserve all snippet fields)
    * `sendMessage()` — posts to live chat via `liveChatMessages.insert`
    * Live chat polling — adaptive interval driven by API's `pollingIntervalMillis` (min 2 s); skips first page to avoid replaying history
    * Status polling (60 s interval) — detects active broadcast, updates `streamStatus`, viewer count from `liveStreamingDetails.concurrentViewers`
    * In-memory chapter/marker store: `createMarker(description?, timestamp?)` stores `StreamMarker` objects
    * `getChapterDescriptionBlock()` serialises chapters to YouTube timestamp format (`0:00 Intro\n1:23 Q&A\n...`)
    * `getMarkers(options?)` — returns last N markers (default limit 20), filterable by `videoId`
    * `clearMarkers()` resets the chapter store (e.g. at stream end)
    * `getChannelInfo()` — returns `{ channelId, channelTitle, broadcastId, liveChatId }`
- Twitch: OAuth2-only integration (no RTMP stream key)
    * Real OAuth2 Authorization Code flow; tokens auto-refreshed and persisted to `~/.yash/twitch_tokens.json`
    * Helix API: update channel title, game/category (resolved by name → ID), tags
    * Stream markers via Helix `POST /helix/streams/markers` (requires channel live); returns position in seconds and marker ID
    * Read markers via Helix `GET /helix/streams/markers` — filterable by videoId
    * Chat via `@twurple/chat` (IRC-over-WebSocket): send and receive messages with badge/color metadata
    * EventSub WebSocket: `stream.online`, `stream.offline`, `channel.update`, `channel.chat.message`
    * Stream status seeded from Helix on EventSub connect (handles case where stream was already live when app started)
    * Viewer count polled from Helix every 60 seconds
- Kick: Real OAuth 2.1 PKCE integration via `@nekiro/kick-api`
    * OAuth 2.1 PKCE flow (code verifier/challenge generated locally); tokens persisted to `~/.yash/kick_tokens.json`; pending PKCE verifier persisted to `~/.yash/kick_pending_auth.json` (10-minute TTL, survives restarts)
    * `getAuthUrl()` / `handleOAuthCallback(code)` — browser-based consent flow; callback at `GET /api/kick/callback`
    * `updateStreamMetadata()` — updates title/category/tags via Kick channels API
    * `sendMessage()` — posts to chat via kick-api chat module
    * Incoming chat receive is not supported (kick-api has no real-time message events at MVP level)
    * Status polling (60 s interval) — viewer count from livestreams endpoint
    * `createMarker()` returns `null`, `getMarkers()` returns `[]` — Kick has no marker API
    * Required OAuth scopes: `user:read`, `channel:read`, `channel:write`, `chat:write`, `events:subscribe`

### Configuration
Configuration is stored in `[root]/config.json`. Environment variables take precedence over file values.

```json
{
  "demo": false,
  "obs": {
    "websocket": {
      "server": "127.0.0.1",
      "port": "4455",
      "password": ""
    }
  },
  "platforms": {
    "youtube": {
      "enabled": true,
      "streamKey": "",
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/youtube/callback",
      "showViewers": true
    },
    "twitch": {
      "enabled": true,
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/twitch/callback",
      "showViewers": true
    },
    "kick": {
      "enabled": true,
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/kick/callback",
      "showViewers": true
    }
  }
}
```

**Environment variable overrides:**

| Variable | Config key |
|---|---|
| `YASH_DEMO` | `demo` |
| `YASH_OBS_SERVER` | `obs.websocket.server` |
| `YASH_OBS_PORT` | `obs.websocket.port` |
| `YASH_OBS_PASSWORD` | `obs.websocket.password` |
| `YASH_OBS_RECONNECT_BASE_MS` | `obs.websocket.reconnectBaseMs` |
| `YASH_OBS_RECONNECT_MAX_MS` | `obs.websocket.reconnectMaxMs` |
| `YASH_OBS_RECONNECT_MULTIPLIER` | `obs.websocket.reconnectMultiplier` |
| `YASH_OBS_RECONNECT_MAX_ATTEMPTS` | `obs.websocket.reconnectMaxAttempts` |
| `YASH_OBS_CONNECT_DELAY_MS` | `obs.websocket.connectDelayMs` |
| `YASH_PLATFORM_YOUTUBE_STREAMKEY` | `platforms.youtube.streamKey` |
| `TWITCH_CLIENT_ID` | `platforms.twitch.clientId` |
| `TWITCH_CLIENT_SECRET` | `platforms.twitch.clientSecret` |
| `TWITCH_REDIRECT_URI` | `platforms.twitch.redirectUri` |
| `YOUTUBE_CLIENT_ID` | `platforms.youtube.clientId` |
| `YOUTUBE_CLIENT_SECRET` | `platforms.youtube.clientSecret` |
| `YOUTUBE_REDIRECT_URI` | `platforms.youtube.redirectUri` |
| `KICK_CLIENT_ID` | `platforms.kick.clientId` |
| `KICK_CLIENT_SECRET` | `platforms.kick.clientSecret` |
| `KICK_REDIRECT_URI` | `platforms.kick.redirectUri` |

### Features
- OAuth authentication flows for all platforms
    * Twitch: real OAuth2 Authorization Code flow — visit `GET /api/twitch/auth` to initiate, callback handled at `GET /api/twitch/callback`
    * YouTube: real OAuth2 Authorization Code flow — visit `GET /api/youtube/auth` to initiate, callback handled at `GET /api/youtube/callback`; TUI `/connect youtube` returns a redirect URL via `POST /api/connect/youtube`
    * Kick: real OAuth 2.1 PKCE flow — visit `GET /api/kick/auth` to initiate, callback handled at `GET /api/kick/callback`; TUI `/connect kick` returns a redirect URL via `POST /api/connect/kick`, and opens a credentials setup modal if `clientId`/`clientSecret` are missing
- Unified chat interface with platform-specific message normalization
- Stream control (start/stop/update metadata)
- Stream markers / chapter points
    * `PlatformProvider.createMarker(description?, timestamp?)` — creates a marker on the platform
    * `PlatformProvider.getMarkers(options?)` — retrieves past markers (filterable by videoId)
    * `StreamMarker` type: `{ id, createdAt, description, positionInSeconds, platform, videoId?, url? }`
    * YouTube: in-memory store with chapter description serialisation helper
    * Twitch: real Helix API (stream must be live); includes position and VOD URL
    * Kick: returns `null` / `[]` gracefully (not supported by Kick API)
- Webhook/event handling for real-time updates (Twitch EventSub WebSocket)
- OBS-studio WebSocket integration
- Platform selector for targeted messaging
- Demo mode: all services report as connected/authenticated without real network connections. Enabled via `"demo": true` in `config.json` or `YASH_DEMO=true` env var. Disabled by default. TUI shows a `[DEMO MODE]` label in the status bar; `/api/obs/status` includes `"demo": true`.

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | React webview (stream controls + chat) |
| GET | `/unified` | Unified chat view (all platforms) |
| GET | `/sidebyside` | Side-by-side chat view |
| GET | `/api/status` | Platform + stream status for all platforms |
| GET | `/api/chat/history` | Full chat message history |
| POST | `/api/chat/send` | Send message: `{ message, platforms? }` |
| GET | `/api/stream` | Read persisted stream metadata from config |
| POST | `/api/stream` | Update metadata on platforms: `{ platforms?, metadata? }` — also persists to `config.json` |
| POST | `/api/stream/marker` | Cross-platform marker: `{ platforms?, description?, timestamp? }` |
| GET | `/api/help` | List all available / commands (for WebUI consumption) |
| GET | `/api/settings` | Read all settings or `?key=<k>` for a single key |
| POST | `/api/settings` | Write a setting: `{ key, value }` |
| POST | `/api/connect/youtube` | Returns YouTube OAuth redirect URL: `{ redirect }` |
| POST | `/api/connect/twitch` | Returns Twitch OAuth redirect URL: `{ redirect }` |
| POST | `/api/connect/kick` | Returns Kick OAuth redirect URL: `{ redirect }` |
| GET | `/api/js/commands.js` | Shared WebUI command module (ESM bundle of `src/utils/webCommands.ts`) |
| GET | `/api/twitch/auth` | Redirect to Twitch OAuth consent screen |
| GET | `/api/twitch/callback` | Twitch OAuth callback (exchanges code for tokens) |
| GET | `/api/twitch/channel` | Read channel title, game, tags from Helix |
| PATCH | `/api/twitch/channel` | Update channel: `{ title?, game?, tags? }` — also persists to `config.json` |
| POST | `/api/twitch/marker` | Create Twitch stream marker: `{ description? }` |
| GET | `/api/twitch/markers` | Read Twitch markers: `?videoId=<id>&limit=<n>` |
| GET | `/api/youtube/auth` | Redirect to Google OAuth consent screen |
| GET | `/api/youtube/callback` | YouTube OAuth callback (exchanges code for tokens) |
| GET | `/api/youtube/channel` | Channel info: `{ channelId, channelTitle, broadcastId, liveChatId }` |
| GET | `/api/youtube/markers` | Read YouTube chapters: `{ markers, descriptionBlock }` |
| GET | `/api/youtube/setup` | Read YouTube stream setup config (playlists, chapters, tags, description) |
| POST | `/api/youtube/setup` | Write YouTube stream setup config |
| GET | `/api/youtube/playlists` | List channel playlists |
| GET | `/api/kick/auth` | Redirect to Kick OAuth consent screen |
| GET | `/api/kick/callback` | Kick OAuth callback (exchanges code for tokens via PKCE) |
| GET | `/api/kick/channel` | Kick channel info: `{ title, slug, category, categoryId, followers, verified }` |
| PATCH | `/api/kick/channel` | Update Kick channel: `{ title?, game?, tags? }` — also persists to `config.json` |
| GET | `/api/obs/status` | OBS connection status + metrics |
| GET | `/api/metrics` | JSON metrics snapshot |
| GET | `/metrics` | Prometheus text format metrics |
| POST | `/api/admin/keys` | Create admin key |
| GET | `/api/admin/keys` | List admin keys |
| POST | `/api/admin/keys/revoke` | Revoke admin key: `{ id }` |
| POST | `/api/admin/keys/update-roles` | Update key roles |
| GET | `/api/admin/audit/tail` | Tail audit log: `?lines=<n>` |
| GET | `/api/admin/audit/verify` | Verify audit log integrity |

## Project Structure
```
src/
├── platforms/
│   ├── base.ts          # PlatformProvider interface + shared types
│   ├── youtube.ts       # Real OAuth2 + Google Data API v3; chat + status polling; chapter store
│   ├── twitch.ts        # Real OAuth2 + Helix + EventSub + Chat (Twurple)
│   └── kick.ts          # Real OAuth 2.1 PKCE + @nekiro/kick-api; status polling
├── services/
│   ├── auth.service.ts
│   ├── chat.service.ts
│   ├── stream.service.ts
│   └── obs.service.ts
├── ui/                  # React components (Dashboard, StreamControls, ChatDisplay, MessageInput, StatusBar)
├── utils/
│   ├── webCommands.ts   # Shared WebUI command module (consumed by main.tsx + served as /api/js/commands.js)
│   └── settings.ts      # Persistent settings store
├── index.ts             # Web server entry point
└── index.tsx            # TUI entry point
```

### Key types (`src/platforms/base.ts`)

```typescript
interface StreamMetadata {
  title?: string;
  game?: string;
  description?: string;
  scheduleId?: string;
  tags?: string[];
}

interface StreamMarker {
  id: string;
  createdAt: Date;
  description: string;
  positionInSeconds: number;
  platform: string;
  videoId?: string;  // VOD ID (Twitch)
  url?: string;      // Deep-link to marker position in VOD (Twitch)
}

interface GetMarkersOptions {
  videoId?: string;
  limit?: number;
}

interface PlatformProvider {
  authenticate(): Promise<AuthResult>;
  isAuthenticated(): boolean;
  logout(): Promise<void>;
  updateStreamMetadata(metadata: StreamMetadata): Promise<MetadataUpdateResult>;
  getStreamKey(): string;
  getStreamStatus(): StreamStatus;
  sendMessage(message: string): Promise<void>;
  onMessage(callback: (msg: ChatMessage) => void): () => void;
  setupWebhooks(config: WebhookConfig): Promise<void>;
  getPlatformName(): string;
  getStatus(): PlatformStatus;
  getViewerCount(): number;
  createMarker(description?: string, timestamp?: number): Promise<StreamMarker | null>;
  getMarkers(options?: GetMarkersOptions): Promise<StreamMarker[]>;
}

// Note: setStreamKey / startStream / stopStream are YouTube-specific or removed.
// YouTube exposes setStreamKey(); Twitch and Kick use OAuth only (no RTMP key needed).
```

### Runtime dependencies

| Package | Purpose |
|---------|---------|
| `@opentui/core`, `@opentui/react` | Terminal UI framework |
| `react`, `react-dom` | React for the web dashboard |
| `@twurple/auth` | Twitch OAuth2 + token refresh |
| `@twurple/api` | Twitch Helix API client |
| `@twurple/chat` | Twitch IRC-over-WebSocket chat |
| `@twurple/eventsub-ws` | Twitch EventSub WebSocket listener |
| `@nekiro/kick-api` | Kick OAuth 2.1 PKCE + channels/chat API client |

## Integration tests
- Chats webview with `playwright-cli` skill, record screenshots in [tmp]/web/
- TUI with `vhs` skill, record demos in [tmp]/tui/
- Use [root]/config.json (actual working) configuration to execute integration tests
- Test websocket communication with obs-studio (ignore if connection refused, aka obs-studio is off)

## Development Commands
- `bun run src/index.tsx` - Launch the TUI application
- `bun run src/index.ts` - Launch the web server only
- `bun run start` - Launch both TUI and web server concurrently
- `bun test` - Run unit tests only (fast, skips lint/typecheck)
- `bun run test` - Full check: lint → typecheck → tests
- `bun typecheck` - Type-check only (`bun --bun tsc --noEmit`)
- `biome check --write` - Lint and format code
