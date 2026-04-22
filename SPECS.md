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
        * `/connect <youtube|twitch|kick>` — authenticate a platform (Twitch redirects to OAuth; YouTube/Kick use mock auth)
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

### Architecture
- Provider abstraction layer with common `PlatformProvider` interface
- Individual implementations for YouTube, Twitch, and Kick platforms
- Modular service layer (AuthService, ChatService, StreamService, ObsService)
- Event-driven architecture for real-time communication
- Token storage for authentication credentials (file-backed). Encryption/keyring-based storage is considered out of scope for this build.
- OBS-studio integration via obs-websocket library
- Configuration is stored in [root]/config.json

### Platform Support
- YouTube: Handles multiple concurrent streams per key via schedule IDs
    * In-memory chapter/marker store: `createMarker(description?, timestamp?)` stores `StreamMarker` objects with optional position in seconds
    * `getChapterDescriptionBlock()` serialises stored chapters to YouTube description timestamp format (`0:00 Intro\n1:23 Q&A\n...`), ready to be written into the video description via the YouTube Data API v3 when wired up
    * `clearMarkers()` resets the chapter store (e.g. at stream end)
- Twitch: Single stream key implementation
    * Real OAuth2 Authorization Code flow; tokens auto-refreshed and persisted to `~/.yash/twitch_tokens.json`
    * Helix API: update channel title, game/category (resolved by name → ID), tags
    * Stream markers via Helix `POST /helix/streams/markers` (requires channel live); returns position in seconds and marker ID
    * Read markers via Helix `GET /helix/streams/markers` — filterable by videoId
    * Chat via `@twurple/chat` (IRC-over-WebSocket): send and receive messages with badge/color metadata
    * EventSub WebSocket: `stream.online`, `stream.offline`, `channel.update`, `channel.chat.message`
    * Stream status seeded from Helix on EventSub connect (handles case where stream was already live when app started)
    * Viewer count polled from Helix every 60 seconds
- Kick: Single stream key implementation (API integration pending)

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
    "youtube": { "enabled": true, "streamKey": "", "showViewers": true },
    "twitch": {
      "enabled": true,
      "streamKey": "",
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/twitch/callback",
      "showViewers": true
    },
    "kick": { "enabled": true, "streamKey": "", "showViewers": true }
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
| `YASH_PLATFORM_TWITCH_STREAMKEY` | `platforms.twitch.streamKey` |
| `YASH_PLATFORM_KICK_STREAMKEY` | `platforms.kick.streamKey` |
| `TWITCH_CLIENT_ID` | `platforms.twitch.clientId` |
| `TWITCH_CLIENT_SECRET` | `platforms.twitch.clientSecret` |
| `TWITCH_REDIRECT_URI` | `platforms.twitch.redirectUri` |

### Features
- OAuth authentication flows for all platforms
    * Twitch: real OAuth2 Authorization Code flow — visit `GET /api/twitch/auth` to initiate, callback handled at `GET /api/twitch/callback`
    * YouTube, Kick: mock auth (pending real implementation)
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
| POST | `/api/stream/start` | Start stream: `{ platforms?, metadata? }` |
| POST | `/api/stream/stop` | Stop stream: `{ platforms? }` |
| POST | `/api/stream/update` | Update metadata: `{ platforms?, metadata? }` |
| POST | `/api/stream/marker` | Cross-platform marker: `{ platforms?, description?, timestamp? }` |
| GET | `/api/help` | List all available / commands (for WebUI consumption) |
| GET | `/api/settings` | Read all settings or `?key=<k>` for a single key |
| POST | `/api/settings` | Write a setting: `{ key, value }` |
| POST | `/api/connect/youtube` | Trigger YouTube authentication |
| POST | `/api/connect/twitch` | Returns Twitch OAuth redirect URL: `{ redirect }` |
| POST | `/api/connect/kick` | Trigger Kick authentication |
| GET | `/api/js/commands.js` | Shared WebUI command module (ESM bundle of `src/utils/webCommands.ts`) |
| GET | `/api/twitch/auth` | Redirect to Twitch OAuth consent screen |
| GET | `/api/twitch/callback` | OAuth callback (exchanges code for tokens) |
| GET | `/api/twitch/channel` | Read channel title, game, tags from Helix |
| PATCH | `/api/twitch/channel` | Update channel: `{ title?, game?, tags? }` |
| POST | `/api/twitch/marker` | Create Twitch stream marker: `{ description? }` |
| GET | `/api/twitch/markers` | Read Twitch markers: `?videoId=<id>&limit=<n>` |
| GET | `/api/youtube/markers` | Read YouTube chapters: `{ markers, descriptionBlock }` |
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
│   ├── youtube.ts       # Mock auth; in-memory chapter/marker store
│   ├── twitch.ts        # Real OAuth2 + Helix + EventSub + Chat (Twurple)
│   └── kick.ts          # Mock stubs
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
  startStream(metadata: StreamMetadata): Promise<void>;
  stopStream(): Promise<void>;
  updateStreamMetadata(metadata: StreamMetadata): Promise<void>;
  getStreamKey(): string;
  setStreamKey(key: string): void;
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

## Integration tests
- Chats webview with `playwright-cli` skill, record screenshots in [tmp]/web/
- TUI with `vhs` skill, record demos in [tmp]/tui/
- Use [root]/config.json (actual working) configuration to execute integration tests
- Test websocket communication with obs-studio (ignore if connection refused, aka obs-studio is off)

## Development Commands
- `bun run src/index.tsx` - Launch the TUI application
- `bun run src/index.ts` - Launch the web server only
- `bun run start` - Launch both TUI and web server concurrently
- `bun test` - Run all tests
- `biome check --write` - Lint and format code
