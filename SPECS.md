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
        * Element : Platform connected as Status bar showing number of viewers between "()" if activated in "Number of viewers" element
        * Message box
            * position : top/bottom/hide
    * Command /connect [youtube|twitch|kick] to launch connection to platform with auth+save secrets in config
    * Message box to send message to [all|youtube|twitch|kick] platform and receive command "/" (without sending to platforms)
- Usable webviews
    * Route to show unified view of all chats
    * Route to show view of chats side by side with config options to enable any platform (saved in browser)
    * All chats view must have a message box to send messages like TUI, display top/bottom/hide (saved in browser individually)

## Out of scope
- Contributing
- Secrets security (encryption at rest, key rotation, OS keyring integration)
- OS keyring integration (keytar) and related token migration scripts
- Encrypted token storage and encryption-based admin key export/import (hybrid RSA+AES packages)
- Admin endpoints that perform encryption/key export/import or rotation (e.g., /api/admin/rotate-key, /api/admin/export-key, /api/admin/keys/import)
- Repository pre-commit hook installer and .githooks management (pre-commit hook installer scripts)
- Any feature that depends on native keyring binaries or OS-specific keyring modules
- Automatic migration/backup tooling for encrypted secrets

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
- Twitch: Single stream key implementation
- Kick: Single stream key implementation

### Features
- OAuth authentication flows for all platforms
- Unified chat interface with platform-specific message normalization
- Stream control (start/stop/update metadata)
- Webhook/event handling for real-time updates
- OBS-studio WebSocket integration
- Platform selector for targeted messaging

## Project Structure
```
src/
├── platforms/
│   ├── base.ts          # PlatformProvider interface
│   ├── youtube.ts
│   ├── twitch.ts
│   └── kick.ts
├── services/
│   ├── auth.service.ts
│   ├── chat.service.ts
│   ├── stream.service.ts
│   └── obs.service.ts
├── ui/                  # OpenTUI components
├── utils/
└── index.ts             # Entry point
```

## Integration tests
- Chats webview with `playwright-cli` skill, record screenshots in [tmp]/web/
- TUI with `vhs` skill, record demos in [tmp]/tui/
- Use [root]/config.json (actual working) configuration to execute integration tests
- Test websocket communication with obs-studio (ignore if connection refused, aka obs-studio is off)

## Development Commands
- `bun run src/index.ts` - Launch the TUI application
- `bun test` - Run all tests
- `biome check --write` - Lint and format code
