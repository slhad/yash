# Specifications

## Project Overview
Yet Another Streamer Helper (YASH) is a unified platform manager for YouTube, Twitch, and Kick streaming services that handles authentication, communication, and stream management with a standardized interface.

## Technical Requirements

### Runtime and Testing
- Must use [Bun](https://bun.sh) as the runtime and test runner (`bun run`, `bun test`)

### Linting and Formatting
- Must use [Biome](https://biomejs.dev) for linting and formatting (`biome check --write`)

### UI Components
- Must use https://github.com/anomalyco/opentui for UI components

### Architecture
- Provider abstraction layer with common `PlatformProvider` interface
- Individual implementations for YouTube, Twitch, and Kick platforms
- Modular service layer (AuthService, ChatService, StreamService, ObsService)
- Event-driven architecture for real-time communication
- Encrypted token storage for authentication credentials
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
