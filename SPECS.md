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
        * Element : Platform connected as Status bar — single borderless line starting with "Status" label, each platform shown as `platform: STATUS (Xh Xm Xs/viewers)` in green (authenticated) or red (not authenticated); unauthenticated providers display `LOGGED OUT` instead of `OFFLINE`; elapsed time and viewer count `(Xh Xm Xs/x)` only shown when platform is ONLINE, `viewers.visible` setting is true (default), and per-platform `showViewers` is not false in `settings.json`
            * Optional provider logos replace the `youtube` / `twitch` / `kick` text labels when `status.platformIcons.visible` is enabled; icons are downloaded lazily at runtime, cached under `YASH_DATA_DIR/cache/platform-status-icons`, recolored to their platform brand fill, sized per platform by `status.platformIcons.youtube.sizePx`, `status.platformIcons.twitch.sizePx`, and `status.platformIcons.kick.sizePx` (default `24` each), and fall back to text labels if the terminal cannot render inline images
        * Element : Memory status in Status bar — optional `MEM: <rss>` segment showing current YASH RSS for leak tracking; enabled with `memory.status.visible` (default `false`) and color-coded by configurable thresholds `memory.status.greenMaxMb` (default `500`), `memory.status.orangeMinMb` (default `2048`), and `memory.status.redMinMb` (default `5120`)
            * Clicking the memory segment opens a readable detail modal/overlay with current usage, RSS-focused drift windows, abbreviation legend (`RSS`, `heap`, `external`, `ArrayBuffers`, native gap), thresholds, and active warnings
        * Message box
            * position : top/bottom/hide
        * Element : Title (YASH heading)
            * visible: true/false (default: false, toggle with `/settings set title.visible true`)
    * Command /connect [youtube|twitch|kick|obs] to launch connection to platform with auth+save secrets in config
    * Command /exit - exits the application cleanly (TUI only)
    * Command /help - lists all available commands
        * Command /info - fetches current stream/channel info from all providers and prints one `[system] <platform>: …` line per provider in the TUI chat; Kick output also includes current event subscriptions
        * Command `/memory` - prints live process memory, recent growth deltas, and bounded-retention probe counts/warnings for the running YASH process; available from the TUI, WebUI command box, and IPC (`bun run cmd /memory`)
            * TUI-only subcommand `/memory modal` opens the same memory status overlay as clicking the `MEM:` status-bar segment
            * Includes OBS reconnect/socket lifecycle counters (`obsReconnectAttempt`, `obsWsCreateCount`, `obsWsCloseCount`, `obsWsErrorCount`, `obsReconnectDisabled`) to support live leak A/B soaks
            * Includes TUI refresh-loop counters (`updateUiLoopRefreshCount`, `updateUiNonLoopRefreshCount`, `updateLoopEnabled`, `updateLoopSkippedRefreshCount`) to support live TUI leak A/B soaks
            * Runtime memory snapshots and `/api/runtime/status` expose extra RSS telemetry such as native-gap estimate, since-start growth, sample-to-sample delta, 15m min/max window stats, and 30m/60m growth windows to help diagnose idle RSS drift
            * Optional periodic memory telemetry logging appends JSONL records under `YASH_DATA_DIR/logs/memory-telemetry-YYYY-MM-DD.jsonl`, controlled by `memory.telemetry.enabled` and `memory.telemetry.intervalMinutes`
        * The periodic TUI refresh loop should be dirty-driven: when no visible provider/OBS/title/viewer/demo state changed since the last render pass, the 2s loop should skip `updateUI()` instead of rebuilding the chat/sidebar trees
    * Command /logs [clear|tail <n>|visible <true|false>] - manage log display (TUI only)
        * Logger verbosity should also be configurable through `/settings` / the settings modal via `logs.level` with values `debug|info|warn|error|none`
    * Command `/chat clear <all|messages|events|logs>` - clear matching live entries from the TUI Chat pane without affecting persisted history
        * `messages` clears visible chat messages and the raw-message cache used by browse/chatter actions
        * `events` clears non-message operational entries currently shown in the Chat pane
        * `logs` clears log-style entries currently shown in the Chat pane
        * `all` clears all Chat pane entries together
        * Available from both the live TUI and IPC (`bun run cmd`) because it does not open a modal or mutate persisted state; it does not clear the merged "Events & Logs" sidebar
    * Command /msg <all|youtube|twitch|kick> <text> - sends a message to the specified platform(s)
    * Command `/action [action-id] [key=value ...]` - lists public IPC-safe actions, invokes actions directly when all args are optional, and shows help/examples when required args still need values
        * Autocomplete is fuzzy-ranked for command names, `/action` ids, arg names, and enum values: prefix matches first, then substring matches, then subsequence matches
        * Action arg schemas may also advertise dynamic autocomplete providers; bundled OBS actions publish `obs.scenes` / `obs.sources` metadata for `scene=` and scene-qualified `source=` suggestions
        * The live TUI may also invoke visible non-IPC actions through `/action`; modal-only actions such as `obs.shutdown.configTUI`, `obs.startup.configTUI`, and `obs.source-recaller.configTUI` remain blocked over IPC (`bun run cmd`)
    * Command `/scripts | /scripts list | /scripts install <example-id> [repair|force] [copy|link]` - list bundled example scripts and install one into `YASH_DATA_DIR/scripts/<example-id>` without overwriting existing files unless repair/force is requested explicitly
        * Intended for AppImage and packaged installs so users can install tracked example scripts without manually extracting repo files
        * Bundled examples currently include `obs-scene-change`, `obs-startup`, and `obs-source-recaller`
        * `YASH_DATA_DIR/scripts/<example-id>/config.jsonc` is the single source of truth owned by that script; do not split normal script settings across a separate runtime settings file
        * Default install strategy is `link` for local dev checkouts and `copy` for AppImage/packaged runtimes; `link` symlinks immutable tracked files while still copying `config.jsonc` so script-local settings stay user-owned
        * Every bundled script or bundled example script must expose both `/action <prefix>.config` and `/action <prefix>.configTUI`
        * `<prefix>.config` must show/update the script-local settings stored in `YASH_DATA_DIR/scripts/<scriptId>/config.jsonc` and remain callable over IPC
        * `<prefix>.configTUI` must edit the same `config.jsonc` surface from the live TUI and stay blocked over IPC
        * Bundled `obs-scene-change` actions: `activate`, `config`, and `configTUI`; `activate` switches OBS to `scene=` when passed or to the configured `defaultScene` otherwise, so voice bridges can trigger scene changes without needing custom app code
        * Script config files may include a reserved top-level `"$ui"` object for self-describing TUI metadata such as labels, descriptions, widget hints (`toggle`, `json`, `text`), ordering, hidden fields, and wildcard path templates like `titleTemplate`, `labelTemplate`, and `descriptionTemplate`; runtime values remain in the normal config shape outside `"$ui"`, and the generic TUI editor explores nested objects/arrays recursively
        * The generic script config modal should render scalar leaves compactly as single-line editors in the form `key: type = value`, while nested object/array section rows may be renamed through `"$ui"` templates
        * When a focused config row represents an object/array entry inside an array, the generic script config modal must allow local reordering with `[` (move up) / `]` (move down) and local deletion with `x` before save/cancel
        * Bundled `obs-startup` actions: `begin`, `live`, `cancel`, `status`, `config`, and `configTUI`; `live` jumps straight to the configured `liveScene` and reapplies the go-live show/unmute/chat steps without running the prepare/countdown phases; all persisted startup settings now live in `YASH_DATA_DIR/scripts/obs-startup/config.jsonc`
        * Bundled `obs-shutdown` exposes `/action obs.shutdown.config` and `/action obs.shutdown.configTUI` against `YASH_DATA_DIR/scripts/obs-shutdown/config.jsonc`
        * `repair`/`force` refreshes tracked files and merges shipped `config.jsonc` defaults with the user's current `config.jsonc`, preserving existing values and unknown keys
        * Explicit `copy` forces copied tracked files even in local dev; explicit `link` forces symlinked tracked files when the runtime supports it
        * `obs-source-recaller` actions: `config [startPaused=<true|false>]`, `configTUI`, `save source=<source|scene.source> [stage=<inputSettings|sceneItemTransform|sceneItemEnabled>]`, `load source=<source|scene.source>`, `list`, `explore [scene=<scene>]`, `pause`, and `resume`
        * For `save` and `load`, the active OBS program scene is always the trigger scene; an explicit `scene.source` only changes the targeted source path so nested/keyed sources can be captured or restored under the active trigger
        * `obs-source-recaller.save` without `stage=` refreshes all three restore stages for the target source; with `stage=...` it replaces only that stored stage and leaves the other saved stages for that source unchanged
        * `obs-source-recaller` keeps defaults, mutable overrides, pause state, and per-scene source triggers together in `YASH_DATA_DIR/scripts/obs-source-recaller/config.jsonc`; top-level `triggers` is a map of `<scene name>` to ordered restore operations, each operation still carries its `scene.source` ref, and `resume` reapplies matching triggers for the current scene when OBS is connected
        * `obs-source-recaller` restore waits for each OBS request ACK before advancing to the next stage, skips unchanged stages when `checkIfChangedToApply=true`, and isolates auto-load failures to the affected source instead of aborting unrelated sources for the same scene
    * Command /marker [description] [| timestamp] - places a stream marker on all platforms
        * Optional description (chapter label, max 140 chars on Twitch)
        * Optional pipe-delimited timestamp accepts raw seconds, `mm:ss`, or `hh:mm:ss` from stream start (used by YouTube for chapter generation; ignored by Twitch which sets position server-side; Kick does not support markers)
        * Negative timestamps are treated as relative offsets from the current live position on YouTube and clamp at `0` (example: `/marker Replay|-300` means "5 minutes ago")
        * Kick is silently skipped in user-facing marker-create summaries because it has no marker API
        * When no timestamp is provided, YouTube derives the marker position from the current live stream elapsed time when available, falling back to a live API lookup after restart before using `0`
        * TUI output should collapse provider results into a single `[marker] ...` summary line
        * Examples: `/marker Intro | 0`, `/marker Q&A | 3723`, `/marker Boss | 32:44`, `/marker` (unnamed, no timestamp)
        * Examples: `/marker Replay|-300` means "5 minutes ago" on YouTube relative to the current live position
    * Command `/markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]` - lists existing markers per platform, restores missing YouTube chapters from Twitch markers, edits a persisted YouTube chapter, or clears persisted YouTube chapters
        * `restore twitch` fetches recent Twitch markers (default limit `100`) and imports only descriptions that are missing from YouTube's persisted `stream.chapters`
        * Persisted YouTube chapters stay sorted by timestamp so `/markers`, `edit <id>`, and `clear <id>` use stable order after restore/imports
        * `clear` removes only YouTube chapter markers persisted under `stream.chapters` in `YASH_DATA_DIR/settings.json`
        * `edit <id>` opens a TUI modal for persisted YouTube marker `#id`; IPC clients should use the `markers.edit` action with the same selection ID
        * YouTube marker list rows include stable 1-based selection IDs (`#1`, `#2`, ...) derived from the persisted chapter order so commands like `/markers clear 1,2,5` can remove specific entries
        * The edit modal can update both the marker label and timestamp, and IPC can do the same through `markers.edit`
        * Clearing persisted YouTube markers also re-syncs the generated YouTube timestamps block so removed chapters do not linger in the live description
        * Default list target is `all`; default list limit is `20`
        * Examples: `/markers`, `/markers youtube`, `/markers twitch 5`, `/markers restore twitch`, `/markers edit 1`, `/markers clear`, `/markers clear 1,2,5`
    * Command /settings [get <key>|set <key> <value>] - get or set UI settings; running `/settings` with no arguments opens a TUI modal for display/sidebar/viewer preferences and persists changes to `settings.json`
        * Includes `logs.level` for runtime logger verbosity (`debug`, `info`, `warn`, `error`, `none`)
        * Includes `chat.timestamps.visible` for WebUI unified chat timestamp display
        * Includes `status.platformIcons.visible`, `status.platformIcons.youtube.sizePx`, `status.platformIcons.twitch.sizePx`, and `status.platformIcons.kick.sizePx` for runtime-downloaded provider logos in the status bar
        * Includes `memory.status.visible`, `memory.status.greenMaxMb`, `memory.status.orangeMinMb`, and `memory.status.redMinMb` for the status-bar RSS indicator
        * Includes `memory.telemetry.enabled` and `memory.telemetry.intervalMinutes` for periodic RSS telemetry file logging
    * Command `/activity` — opens the activity bar modal showing the full event history (follow, sub, cheer, raid) with platform labels and timestamps (TUI only)
        * `Ctrl+G` opens the same activity modal from the keyboard when no other exclusive modal is active
        * When an activity entry carries chatter identity, clicking the chatter name in the modal opens the chatter info modal for that user
        * YouTube activity entries are sourced from live-chat event types and should continue to appear even if YouTube uses subscriber/member naming variants such as `newSponsorEvent` or `newSubscriberEvent`
    * Command `/inject <platform> <username> <message>` — injects a fake incoming chat message for dev/testing without a live platform connection (TUI only)
    * Command `/setup-youtube` — opens the YouTube stream setup modal (TUI only); configure chaptering, auto-start marker, sync delay, tags, description, subject, and playlist
    * `/stream` modal: per-platform category autocomplete with ↑/↓ navigation — Twitch field (`twitchGame`) calls `/api/twitch/categories` with 300 ms debounce; Kick field (`kickCategory`) calls `/api/kick/categories` with 300 ms debounce; YouTube field uses a static `<select>` dropdown from `/api/youtube/categories`; YouTube Subject field (`game`) shows playlist suggestions from `youtube.searchPlaylists()` (client-side filter of `listPlaylists()`) with 300 ms debounce and a `(new)` indicator when the typed text doesn't match any existing playlist exactly
    * `/stream` modal cascade (`Ctrl+→`): propagates the current field value down the platform chain — Subject → fills Twitch category + Kick category (triggering their autocomplete searches immediately at 0 ms delay); Twitch category → fills Kick category (triggering its search); only cascades to platforms that are currently selected
    * Message box to send message to [all|youtube|twitch|kick] platform and receive command "/" (without sending to platforms)
        * Input history: Up/Down arrow keys navigate previously-sent messages (like a shell history)
        * The TUI persists previously sent commands and plain messages across restarts in `YASH_DATA_DIR/input-history.json`, so Up/Down recall still works after relaunch
        * Plain messages (input not starting with `/`) show a target preview `all|youtube|twitch|kick > message`; `Tab` cycles forward and `Shift+Tab` cycles backward between `all` and currently connected providers before sending
        * Slash commands are echoed into the Chat pane before their output so later feedback lines keep a visible source command context
        * After a successful Twitch send, the chat panel also appends a local self-echo incoming line so Twitch matches the visible send/echo behavior of the other providers
    * Web chat views (`/`, `/unified`, `/sidebyside`)
        * Twitch messages render FrankerFaceZ emotes inline across the WebUI chat surfaces using a cached `/api/twitch/ffz-emotes` lookup keyed by the authenticated Twitch channel login
    * TUI chat rendering
        * Twitch messages render FrankerFaceZ emotes inline in the Chat pane and chatter/history modal message rows when the active terminal supports Kitty-style Unicode image placeholders (for example Ghostty through tmux with `allow-passthrough on` or `allow-passthrough all`); otherwise the original token text remains visible
        * `tui.emotes.scale` controls the TUI inline emote size and applies immediately when changed through `/settings`; users migrating from the early broken sizing behavior may need to increase existing saved values (for example `200` or `400`) to get the desired visible size
        * Persisted chat messages remain plain text; FFZ substitution is render-time only
        * Command parameter autocomplete: after typing a command + space, `Tab` cycles forward through available completions and `Shift+Tab` cycles backward
            * `/connect ` → `youtube | twitch | kick`
            * `/action ` → public action ids; `/action <id> ` → available `key=` args or enum values
            * `/msg ` → `all | youtube | twitch | kick`
            * `/settings ` → `get | set`; `/settings get/set ` → setting key list
            * `/logs ` → `clear | tail | visible`
        * Single-match autocomplete on Enter: if only one command or argument matches the current input, pressing Enter executes that completion directly without needing Tab first
    * Chatter info modal: left-click any chat message, or press Enter while in browse mode (↑/↓ to select a message), to open a modal showing:
        * Platform profile info fetched via `provider.fetchChatterInfo()` (subscriber count, video count, account age, description, avatar URL)
        * Clickable username when the provider can resolve a public profile URL
        * Clickable `Session`, `All time`, and `Context` tab labels in addition to the keyboard shortcuts
        * Session stats: number of messages sent this session and time first seen; for chatters whose messages carry a stable stream ID, session history follows that stream across YASH restarts instead of only the current process lifetime
        * Last 200 messages from the persistent message log (cross-session history)
        * Dismiss with Escape or q; modal is exclusive (only one open at a time)
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
        * Platform-specific category fields: `twitchGame` with datalist autocomplete (calls `/api/twitch/categories`); `kickCategory` with datalist autocomplete (calls `/api/kick/categories`); YouTube category `<select>` dropdown (populated from `/api/youtube/categories`)
        * Status bar shows per-platform elapsed time + viewer counts, auto-refreshes every second, and may also show the optional memory RSS segment when `memory.status.visible` is enabled
    * Route /unified to show unified view of all chats
        * Message box supports all applicable / commands: `/help`, `/msg`, `/marker`, `/markers`, `/connect`, `/settings`
        * Status bar shows per-platform elapsed time + viewer counts, plus the optional memory RSS segment when enabled
        * URL querystring configures initial state and stays in sync as options change: `?position=top|bottom|hide` overrides stored position; `?platform=all|youtube|twitch|kick` sets initial target platform; toggling either option updates the URL via `history.replaceState`
    * Route /sidebyside to show view of chats side by side with config options to enable any platform (saved in browser); URL querystring configures initial state and stays in sync: `?position=top|bottom|hide` overrides stored position; `?platforms=youtube,twitch,kick` (comma-separated subset) sets visible columns; toggling either option updates the URL via `history.replaceState`
        * Message box supports all applicable / commands: `/help`, `/msg`, `/marker`, `/markers`, `/connect`, `/settings`
    * All chats view must have a message box to send messages like TUI, display top/bottom/hide (saved in browser individually)
        * Input history: Up/Down arrow keys navigate previously-sent messages
        * Inline parameter hints while typing a `/` command (shows valid next tokens below input)
    * WebUI commands available in all chat message boxes (`/`, `/unified`, `/sidebyside`):
        * `/help` — list available commands (fetched from `/api/help`)
        * `/msg <all|youtube|twitch|kick> <text>` — send targeted platform message
        * `/marker [description] [| timestamp]` — create stream marker on all (or selected) platforms using seconds, `mm:ss`, or `hh:mm:ss`
        * `/markers restore twitch [limit] | clear [all|ids] | [all|youtube|twitch|kick] [limit]` — list existing markers, restore missing YouTube chapters from Twitch, or clear persisted YouTube chapters
        * `/connect <youtube|twitch|kick|obs>` — authenticate a platform (all three redirect to real OAuth flows)
        * `/settings get <key>` — read a persistent setting via `/api/settings`
        * `/settings set <key> <value>` — write a persistent setting via `/api/settings`
    * TUI-only commands (not available in WebUI or via CLI IPC): `/exit`, `/logs`, `/info`, `/stream`, `/setup-youtube`, `/history`, `/activity`, `/inject`, bare `/settings` (no arguments), `/chatter` (modal path)
- Scriptable CLI interface via IPC
    * `bun run cmd <command> [args...]` — forwards a command to the running yash TUI process and prints its output to stdout, then exits
    * Both `/cmd` and `cmd` argument forms are accepted (the leading `/` is inserted automatically if omitted)
    * Prints `yash is not running` to stderr and exits with code 1 when yash is not active (socket absent or connection refused)
    * Commands available over IPC: `/action`, `/marker`, `/markers`, `/settings get <key>`, `/settings set <key> <val>`, `/connect`, `/msg`, `/help`, and most non-modal commands
    * Example-script management commands are also IPC-safe: `bun run cmd /scripts list`, `bun run cmd /scripts install <example-id>`, and `bun run cmd /scripts install <example-id> repair`
    * IPC command output is also mirrored into the live TUI chat pane, and the invoked command line is echoed there first, so `bun run cmd /markers` surfaces the same visible context as typing `/markers` in-app
    * Commands blocked over IPC (require the live TUI): `/exit`, `/stream`, `/setup-youtube`, `/history`, bare `/settings`, `/chatter`

## Out of scope (do not touch)
- Contributing
- Secrets security (encryption at rest, key rotation, OS keyring integration)
- OS keyring integration (keytar) and related token migration scripts
- Encrypted token storage and encryption-based admin key export/import (hybrid RSA+AES packages)
- Repository pre-commit hook installer and .githooks management (pre-commit hook installer scripts)
- Git-managed pre-commit installation flows; repo policy enforcement for Codex-driven commits should use the repo-local Codex hook instead
- Any feature that depends on native keyring binaries or OS-specific keyring modules
- Automatic migration/backup tooling for encrypted secrets
- manifest/checksum generation, signing and verification, ownership remediation

## Deliverables
* Screenshots of webviews made with playwright
* Gif of TUI made with VHS
* All temporary demo assets used to produce those deliverables must live under `[tmp]/...`; only hosted URLs belong in PRs/docs, not repo-committed binaries or ad hoc `demo/` files
* PR-body inline videos must use GitHub `user-attachments` URLs generated through the shared GitHub PR attachment helper (`bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts ...`); release asset URLs are acceptable as downloads but are not the authoritative inline-video path

## Development Commands
- `bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts --file tmp/<artifact>.mp4 [--pr <number|url>] [--mode upload|apply]` — upload a local artifact through GitHub's PR editor to mint a `github.com/user-attachments/assets/...` URL. In `apply` mode, the script can replace a placeholder in the current PR body (or a provided body file) and save it through `gh pr edit`.
  - Default Playwright profile: `~/.cache/codex/github-pr-attachments/playwright-profile`

## Documentation Requirements
- `README.md` must contain a Mermaid diagram describing the `/stream` command validation and execution flow end to end
- The Mermaid diagram must cover, at minimum:
    * target platform selection
    * config persistence
    * per-provider validation / target resolution
    * YouTube mutable-broadcast selection or fallback creation/bind flow
    * provider update success / warning / error outcomes
- Any change to `/stream` validation, provider targeting, fallback behavior, or update sequencing must update that Mermaid diagram in `README.md` in the same change

## Technical Requirements

### Runtime and Testing
- Must use [Bun](https://bun.sh) as the runtime and test runner (`bun run`, `bun test`)
- Playwright-based repo helpers that interact with GitHub must use a persistent browser profile so the user can sign in once and reuse the saved session for later PR attachment uploads

### Linting and Formatting
- Must use [Biome](https://biomejs.dev) for linting and formatting (`biome check --write`)

### UI Components
- Must use https://github.com/anomalyco/opentui for UI components in terminal

### Logging
- All log output is written to both stderr (console) and `~/.config/yash/yash.log` (file transport)
- The file always includes an ISO 8601 timestamp even when the console formatter omits it
- Log file is rotated when it exceeds 10 MB (renamed to `yash.log.1`); data directory defaults to `~/.config/yash` and can be overridden via `YASH_DATA_DIR`

### Architecture
- Provider abstraction layer with common `PlatformProvider` interface
- Individual implementations for YouTube, Twitch, and Kick platforms
- Modular service layer (AuthService, ChatService, StreamService, ObsService)
- Event-driven architecture for real-time communication
- Token storage for authentication credentials (file-backed). Encryption/keyring-based storage is considered out of scope for this build.
- OBS-studio integration via obs-websocket library
    * OBS websocket connection retries apply both after disconnects and when OBS is still closed during YASH startup
- Runtime bootstrap config is stored in `YASH_DATA_DIR/config.json` (default `~/.config/yash/config.json`); mutable runtime settings are stored in `YASH_DATA_DIR/settings.json`; if the runtime config file does not exist yet and a legacy `[root]/config.json` is present, YASH migrates it once on startup and then moves mutable runtime state into `settings.json`
- TUI and web server run as a single process (`bun run src/index.tsx`); `index.tsx` imports `index.ts` as a side-effect to start `Bun.serve` in the same process. Running them as separate processes causes port 3000 conflicts.
- `Bun.serve` must use `development: false`. In development mode, Bun writes HTML bundle timing lines (e.g. `Bundled page in 31ms: index.html`) directly to fd 1 via native I/O, bypassing both `process.stdout` and the JS `console.*` API. Since `@opentui` renders the TUI on that same fd, these writes bleed into the TUI display and cannot be intercepted at the JS level. `development: false` suppresses this output; HMR is intentionally disabled as a result.
- An IPC server (`src/ipc/server.ts`) is started after `initializeServices()` completes; it listens on a Unix Domain Socket at `YASH_DATA_DIR/yash.sock`. It cleans up any stale socket file on startup and removes the socket on `process.on('exit')`. SIGTERM is handled alongside SIGINT for a clean shutdown.
- IPC protocol: one-round-trip newline-delimited JSON — request `{"command":"<cmd>"}`, response `{"ok":true,"output":"<text>"}` or `{"ok":false,"error":"<msg>"}`.
- Socket path is resolved by `src/ipc/socket-path.ts` as `path.join(getDataDir(), 'yash.sock')`.
- `commandHandlers` in `src/index.tsx` accept an `emit: (line: string) => void` callback so the same handler logic serves both TUI rendering and IPC output collection. TUI path: `(line) => lastMessages.push(line)`; IPC path (`handleCommandForCli()`): `(line) => lines.push(line)`, joined and returned as the response `output`.
- IPC actions can opt into live-chat mirroring with `ipcOutputMode: 'response_and_tui'` on their `YashActionDefinition`; when enabled, `invoke_action` still returns normal `output`/`warnings` to the caller and also appends those lines to the running TUI chat pane.

### Platform Support
- YouTube: Real OAuth2 integration via Google Data API v3
    * OAuth2 Authorization Code flow; tokens persisted to `~/.config/yash/youtube_tokens.json`; access token auto-refreshed before expiry
    * `getAuthUrl()` / `handleOAuthCallback(code)` — browser-based consent flow; callback at `GET /api/youtube/callback`
    * `updateStreamMetadata()` — updates live broadcast title/description via `liveBroadcasts.update` (GET + PUT to preserve all snippet fields)
        * Only mutable broadcasts (`created`, `ready`, `testing`, `live`) may be targeted; completed/revoked broadcasts must never be mutated by `/stream`
        * If no mutable broadcast exists for the configured stream key, YASH creates a new fallback broadcast via `liveBroadcasts.insert`, binds it to the saved stream via `liveBroadcasts.bind`, and then applies metadata updates to that new broadcast
        * Limitation: the public YouTube Live Streaming API requires `snippet.scheduledStartTime` on insert, so this fallback cannot perfectly match Studio's unscheduled "Direct stream" object; it may briefly exist as an upcoming broadcast before going live
        * Verified behavior: Studio can create a `ready` "Direct stream" broadcast with `snippet.scheduledStartTime = null`, but public `liveBroadcasts.insert` rejects Unix epoch zero (`1970-01-01T00:00:00.000Z`) with `invalidScheduledStartTime`; YASH therefore cannot reproduce Studio's unscheduled direct-stream sentinel through the public API
        * If no broadcast target exists, returns diagnostics instead of a silent YouTube no-op; diagnostics include up to the last 10 broadcasts grouped as `active`, `scheduled`, and `all`
    * `sendMessage()` — posts to live chat via `liveChatMessages.insert`
    * Live chat receive uses `liveChatMessages.streamList` over gRPC, resuming with `nextPageToken` after reconnects and skipping initial pre-connect history to avoid replaying old messages in YASH
        * Runtime safeguard: YASH pauses reconnects for 60 minutes after quota exhaustion and stops the stream immediately when YouTube reports that the live chat ended or no longer exists
    * Status polling (60 s interval) — detects active broadcast, updates `streamStatus`, viewer count from `liveStreamingDetails.concurrentViewers`
        * On startup, the TUI Chat pane emits a `[system] YouTube start: ...` summary showing whether the current broadcast is new or unchanged and whether auto-clear markers was enabled and done/skipped
    * In-memory chapter/marker store: `createMarker(description?, timestamp?)` stores `StreamMarker` objects
    * `getChapterDescriptionBlock()` serialises chapters to YouTube timestamp format (`0:00 Intro\n1:23 Q&A\n...`)
    * `getMarkers(options?)` — returns last N markers (default limit 20), filterable by `videoId`
    * `clearMarkers()` resets the chapter store (e.g. at stream end)
    * Each marker creation also re-syncs the current YouTube video/broadcast description so the timestamps block is persisted immediately while live
    * Chapter markers are also persisted in the runtime `settings.json` at `stream.chapters` and reloaded on startup so YASH keeps chapter context across restarts
    * `getChannelInfo()` — returns `{ channelId, channelTitle, broadcastId, liveChatId }`
- Twitch: OAuth2-only integration (no RTMP stream key)
    * Real OAuth2 Authorization Code flow; tokens auto-refreshed and persisted to `~/.config/yash/twitch_tokens.json`
    * Helix API: update channel title, game/category (resolved by name → ID), tags
    * Stream markers via Helix `POST /helix/streams/markers` (requires channel live); returns position in seconds and marker ID
    * Read markers via Helix `GET /helix/streams/markers` — filterable by videoId
    * Chat via `@twurple/chat` (IRC-over-WebSocket): send and receive messages with badge/color metadata
    * EventSub WebSocket: `stream.online`, `stream.offline`, `channel.update`, `channel.chat.message`
    * Stream status seeded from Helix on EventSub connect (handles case where stream was already live when app started)
    * Viewer count polled from Helix every 60 seconds
    * `searchCategories(query, limit?)` — calls Helix `/search/categories` paginated
- Kick: Real OAuth 2.1 PKCE integration via `@nekiro/kick-api`
    * OAuth 2.1 PKCE flow (code verifier/challenge generated locally); tokens persisted to `~/.config/yash/kick_tokens.json`; pending PKCE verifier persisted to `~/.config/yash/kick_pending_auth.json` (10-minute TTL, survives restarts)
    * `getAuthUrl()` / `handleOAuthCallback(code)` — browser-based consent flow; callback at `GET /api/kick/callback`
    * `updateStreamMetadata()` — updates title/category/tags via Kick channels API
    * `sendMessage()` — posts to chat via kick-api chat module
    * Incoming chat receive is not supported (kick-api has no real-time message events at MVP level)
    * Status polling (60 s interval) — viewer count from livestreams endpoint
    * `createMarker()` returns `null`, `getMarkers()` returns `[]` — Kick has no marker API
    * Required OAuth scopes: `user:read`, `channel:read`, `channel:write`, `chat:write`, `events:subscribe`
    * `searchCategories(query, limit?)` — live search via Kick categories API
    * `setupWebhooks()` starts a smee.io relay, then ensures the app is subscribed to `chat.message.sent` via `GET/POST /public/v1/events/subscriptions`; the public relay URL is logged at startup and available via `getWebhookUrl()` — register this URL in Kick's developer app settings
    * `handleWebhookEvent(payload)` — dispatches incoming Kick chat webhook events into the chat stream

### Configuration
Bootstrap config is stored in `YASH_DATA_DIR/config.json` (default `~/.config/yash/config.json`). Mutable YASH-owned runtime state is stored in `YASH_DATA_DIR/settings.json`. If the runtime config file does not exist yet and a legacy `[root]/config.json` is present, YASH migrates that legacy file once on startup and then moves mutable settings into `settings.json`. Environment variables take precedence over config file values.

```json
{
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
      "redirectUri": "http://localhost:3000/api/youtube/callback"
    },
    "twitch": {
      "enabled": true,
      "streamKey": "",
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/twitch/callback"
    },
    "kick": {
      "enabled": true,
      "streamKey": "",
      "clientId": "",
      "clientSecret": "",
      "redirectUri": "http://localhost:3000/api/kick/callback"
    }
  },
  "server": {
    "port": 3000,
    "host": "localhost"
  }
}
```

Mutable settings live in `settings.json`, including `demo`, `chat.*`, `stream.*`, `platforms.youtube.setup`, `platforms.<provider>.showViewers`, and TUI/WebUI display preferences.

`config.json` and `settings.json` are reserved for YASH itself. User scripts own `YASH_DATA_DIR/scripts/<scriptId>/config.jsonc` as their primary persisted surface; do not document normal script settings as part of YASH's top-level settings surface.

Memory telemetry logs, when enabled, are written under `YASH_DATA_DIR/logs/` as daily append-only JSONL files named `memory-telemetry-YYYY-MM-DD.jsonl` rather than one file per startup.

Pre-v1 rule: do not add migration/compatibility behavior for old user-script or app-data layouts unless a task explicitly requires it; format changes may require resetting a script's local `config.jsonc`.

**Environment variable overrides:**

| Variable | Config key |
|---|---|
| `YASH_DATA_DIR` | Data directory for config, settings, log, message DB, and IPC socket (`yash.sock`); default `~/.config/yash` |
| `YASH_DEMO` | `settings.demo` |
| `YASH_OBS_SERVER` | `obs.websocket.server` |
| `YASH_OBS_PORT` | `obs.websocket.port` |
| `YASH_OBS_PASSWORD` | `obs.websocket.password` |
| `YASH_OBS_RECONNECT_BASE_MS` | `obs.websocket.reconnectBaseMs` |
| `YASH_OBS_RECONNECT_MAX_MS` | `obs.websocket.reconnectMaxMs` |
| `YASH_OBS_RECONNECT_MULTIPLIER` | `obs.websocket.reconnectMultiplier` |
| `YASH_OBS_RECONNECT_MAX_ATTEMPTS` | `obs.websocket.reconnectMaxAttempts` |
| `YASH_OBS_DISABLE_RECONNECT` | `obs.websocket.disableReconnect` |
| `YASH_OBS_CONNECT_DELAY_MS` | `obs.websocket.connectDelayMs` |
| `YASH_DISABLE_AUTH_AUTO_REFRESH` | Disable AuthService token refresh loop for controlled soak/A-B runs |
| `YASH_DISABLE_YOUTUBE_STARTUP` | Disable YouTube startup hook/poll setup for controlled soak/A-B runs |
| `YASH_DISABLE_TWITCH_STARTUP` | Disable Twitch startup hook/listener setup for controlled soak/A-B runs |
| `YASH_DISABLE_KICK_STARTUP` | Disable Kick startup hook/poll/relay setup for controlled soak/A-B runs |
| `YASH_DISABLE_TWITCH_RUNTIME` | Disable Twitch auth-restored runtime startup (chat/viewer poll) for controlled soak/A-B runs |
| `YASH_DISABLE_KICK_RUNTIME` | Disable Kick auth-restored runtime startup (poll) for controlled soak/A-B runs |
| `YASH_DISABLE_TUI_UPDATE_LOOP` | Disable the 2s periodic TUI refresh loop for controlled soak/A-B runs |
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
| `YASH_TUI_ONLY` | When set to `1`, skips HTML page routes (`/`, `/unified`, `/sidebyside`); only API + OAuth endpoints are registered |
| `YASH_PORT` | HTTP server port; overrides `server.port` in config (default `3000`) |

### Features
- OAuth authentication flows for all platforms
    * Twitch: real OAuth2 Authorization Code flow — visit `GET /api/twitch/auth` to initiate, callback handled at `GET /api/twitch/callback`
    * YouTube: real OAuth2 Authorization Code flow — visit `GET /api/youtube/auth` to initiate, callback handled at `GET /api/youtube/callback`; TUI `/connect youtube` returns a redirect URL via `POST /api/connect/youtube`
    * Kick: real OAuth 2.1 PKCE flow — visit `GET /api/kick/auth` to initiate, callback handled at `GET /api/kick/callback`; TUI `/connect kick` returns a redirect URL via `POST /api/connect/kick`, and opens a credentials setup modal if `clientId`/`clientSecret` are missing
- Unified chat interface with platform-specific message normalization
- Persistent message log: all incoming chat messages are appended to a SQLite database at `YASH_DATA_DIR/messages.db`; survives restarts; used by the chatter info modal to show per-user cross-session message history (up to 200 messages per user)
- Stream control (start/stop/update metadata)
- Stream markers / chapter points
    * `PlatformProvider.createMarker(description?, timestamp?)` — creates a marker on the platform
    * `PlatformProvider.getMarkers(options?)` — retrieves past markers (filterable by videoId)
    * `StreamMarker` type: `{ id, createdAt, description, positionInSeconds, platform, videoId?, url? }`
    * YouTube: in-memory store with chapter description serialisation helper; markers are also persisted in the runtime `settings.json` under `stream.chapters`, and if no explicit timestamp is supplied, markers use the current live elapsed time when `streamStartTime` is known, fall back to a live API lookup when needed, and each marker immediately re-syncs the live description timestamp block
    * Twitch: real Helix API (stream must be live); includes position and VOD URL
    * Kick: returns `null` / `[]` gracefully (not supported by Kick API)
- Webhook/event handling for real-time updates (Twitch EventSub WebSocket)
- OBS-studio WebSocket integration
- Platform selector for targeted messaging
- Demo mode: all services report as connected/authenticated without real network connections. Enabled via `"demo": true` in the runtime `settings.json` or `YASH_DEMO=true` env var. Disabled by default. TUI shows a `[DEMO MODE]` label in the status bar; `/api/obs/status` includes `"demo": true`.

### API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | React webview (stream controls + chat) |
| GET | `/unified` | Unified chat view (all platforms) |
| GET | `/sidebyside` | Side-by-side chat view |
| GET | `/api/status` | Platform + stream status for all platforms; each platform entry includes `viewerCount: number` and `streamStartTime: string\|null` |
| GET | `/api/chat/history` | Chat history for the current stream context when a live/override `streamId` is known (merged from persisted SQLite history plus matching in-memory messages); otherwise falls back to the current in-memory chat history |
| POST | `/api/chat/send` | Send message: `{ message, platforms? }` |
| GET | `/api/twitch/ffz-emotes` | Cached FrankerFaceZ emote map for the authenticated Twitch channel used by WebUI and TUI render-time chat substitution |
| GET | `/api/stream` | Read persisted stream metadata from runtime settings |
| POST | `/api/stream` | Update metadata on platforms: `{ platforms?, metadata? }` — also persists to `YASH_DATA_DIR/settings.json`; response includes `{ success, platformResults }` with per-platform warnings/diagnostics |
| POST | `/api/stream/marker` | Cross-platform marker: `{ platforms?, description?, timestamp? }` |
| GET | `/api/stream/markers` | Cross-platform marker list: `?platform=<name>&limit=<n>` |
| POST | `/api/stream/markers/clear` | Clear persisted YouTube chapter markers from `settings.json`; Twitch/Kick unaffected |
| GET | `/api/help` | List all available / commands (for WebUI consumption) |
| GET | `/api/settings` | Read all settings or `?key=<k>` for a single key |
| POST | `/api/settings` | Write a setting via `{ key, value }` or merge a nested settings patch |
| POST | `/api/connect/youtube` | Returns YouTube OAuth redirect URL: `{ redirect }` |
| POST | `/api/connect/twitch` | Returns Twitch OAuth redirect URL: `{ redirect }` |
| POST | `/api/connect/kick` | Returns Kick OAuth redirect URL: `{ redirect }` |
| GET | `/api/js/commands.js` | Shared WebUI command module (ESM bundle of `src/utils/webCommands.ts`) |
| GET | `/api/twitch/auth` | Redirect to Twitch OAuth consent screen |
| GET | `/api/twitch/callback` | Twitch OAuth callback (exchanges code for tokens) |
| GET | `/api/twitch/channel` | Read channel title, game, tags from Helix |
| PATCH | `/api/twitch/channel` | Update channel: `{ title?, game?, tags? }` — also persists to `YASH_DATA_DIR/settings.json` |
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
| PATCH | `/api/kick/channel` | Update Kick channel: `{ title?, game?, tags? }` — also persists to `YASH_DATA_DIR/settings.json` |
| GET | `/api/kick/categories` | Search Kick categories: `?q=<query>` → `{ categories: string[] }` |
| GET | `/api/kick/webhook` | Returns smee.io relay URL: `{ url: string \| null }` |
| POST | `/api/kick/webhook` | Receives direct Kick webhook events (non-smee tunnels) |
| GET | `/api/youtube/categories` | List YouTube video category names: `{ categories: string[] }` |
| GET | `/api/obs/status` | OBS connection status + metrics |
| GET | `/api/runtime/status` | Runtime memory snapshot with RSS/heap/external bytes, short growth windows, and retention probe warnings |
| GET | `/api/metrics` | JSON metrics snapshot |
| GET | `/metrics` | Prometheus text format metrics, including process memory gauges and registered runtime probe gauges |

## Project Structure
```
src/
├── ipc/
│   ├── socket-path.ts   # Resolves ${YASH_DATA_DIR}/yash.sock via resolveSocketPath()
│   ├── server.ts        # UDS server (node:net); stale-socket cleanup on start; one-round-trip JSON protocol; process.on('exit') teardown
│   └── client.ts        # IPC client; exits 1 + prints "yash is not running" on ENOENT/ECONNREFUSED
├── platforms/
│   ├── base.ts          # PlatformProvider interface + shared types
│   ├── youtube.ts       # Real OAuth2 + Google Data API v3; chat + status polling; chapter store
│   ├── twitch.ts        # Real OAuth2 + Helix + EventSub + Chat (Twurple)
│   └── kick.ts          # Real OAuth 2.1 PKCE + @nekiro/kick-api; status polling
├── services/
│   ├── auth.service.ts
│   ├── chat.service.ts
│   ├── stream.service.ts
│   ├── obs.service.ts
│   ├── chatter-cache.ts  # In-memory cache for chatter profile info (ChatterInfo) + session stats
│   └── message-log.ts    # SQLite-backed message persistence (YASH_DATA_DIR/messages.db)
├── ui/                  # React components (Dashboard, StreamControls, ChatDisplay, MessageInput, StatusBar)
├── utils/
│   ├── webCommands.ts   # Shared WebUI command module (consumed by main.tsx + served as /api/js/commands.js)
│   └── settings.ts      # Persistent settings store
├── services.ts          # Aggregator — imports and exports all initialized service instances
├── cli.ts               # CLI entry point; accepts /cmd or cmd arg form; forwards to running yash via IPC
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
  twitchGame?: string;      // Twitch-specific category (overrides game)
  kickCategory?: string;    // Kick-specific category (overrides game)
  youtubeCategory?: string; // YouTube video category name
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

interface ChatterInfo {
  platform: string;
  userId: string;
  username: string;
  color?: string;
  badges?: Record<string, string>;
  accountCreatedAt?: Date | null;
  description?: string | null;
  profileImageUrl?: string | null;
  subscriberCount?: number | null;
  videoCount?: number | null;
  sessionMessageCount: number;
  sessionFirstSeenAt?: Date;
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
  getStreamStartTime(): Date | null;
  fetchChatterInfo?(userId: string, username: string): Promise<ChatterInfo | null>;
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
- Keep demo source artifacts there too: tapes, helper scripts, captured videos, GIF conversions, and screenshots should all be created under `[tmp]/...`, not tracked folders such as `demo/`
- Use `YASH_DATA_DIR/config.json` and `YASH_DATA_DIR/settings.json` (actual working runtime state) to execute integration tests
- Test websocket communication with obs-studio (ignore if connection refused, aka obs-studio is off)

## Development Commands
- `bun run src/index.tsx` - Launch the TUI application
- `bun run src/index.ts` - Launch the web server only
- `bun run start` - Launch both TUI and web server concurrently
- `bun run validate:repo` - Fail if the current branch introduces tracked demo artifacts outside `tmp/` or tracked binary changes outside `tmp/`
- Repo-local Codex hook: `.codex/hooks.json` runs `scripts/validate-repo-artifacts.ts --codex-pre-tool-use` before Codex-driven `git commit` / `rtk git commit` Bash tool calls and blocks the commit when `bun run validate:repo` fails
- `bun test` - Run unit tests only (fast, skips lint/typecheck)
- `bun run test` - Full check: repo policy validation → lint → typecheck → tests
- `bun typecheck` - Type-check only (`bun --bun tsc --noEmit`)
- `bun run cmd <command> [args...]` - Send a command to the running yash TUI via IPC (e.g. `bun run cmd /marker "Intro | 0"`)
- `bun run cmd /scripts list | /scripts install <example-id> [repair|force]` - List, install, or repair bundled example user scripts in `YASH_DATA_DIR/scripts`
- `biome check --write` - Lint and format code

## Release Automation
- GitHub Actions builds a Linux x86_64 AppImage on pushed tags matching `v*`
- Tag-triggered AppImage builds publish the resulting `.AppImage` file to the matching GitHub release
- GitHub Actions also runs one nightly AppImage build per day on a schedule and uploads the `.AppImage` as a workflow artifact
