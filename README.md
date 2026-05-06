# Yet Another Streamer Helper (YASH)

Disclaimer : I used to stream on Windows with some scripts but when I stared to stream on Linux, it was painful to make Streamer.Bot even works normally that it gave me the idea to replace it with some app on linux. After some failed configuration to run my custom scripts (bash/powershell/typescript within wine) and some AI tests, I decided to give it a shot directly with an app seeing that the Kick api was finally available (it was my last blocker for some tries already on Windows....)

Small toolkit to manage streaming across YouTube, Twitch, and Kick with a unified interface. Written to run on Bun. This repository contains:

- `src/`: TypeScript source (platform providers, services, UI)
- `test/`: Unit and integration tests (run with `bun test`)
- `config.example.json`: Template for bootstrap config stored at `YASH_DATA_DIR/config.json`
- `settings.example.json`: Template for mutable runtime settings stored at `YASH_DATA_DIR/settings.json`

## Quickstart

1. Install dependencies: `bun install`
2. Launch the full app: `bun run start`

## Runtime entrypoints

- `bun run start` starts the current primary entrypoint: `src/index.tsx`
- `src/index.tsx` runs the TUI and imports `src/index.ts` as a side effect to start `Bun.serve` in the same process
- `bun run start:webui` runs only the web server (`src/index.ts`)
- `bun run start:tui` runs the TUI-focused mode (`YASH_TUI_ONLY=1 bun run src/index.tsx`)
- `Bun.serve` intentionally uses `development: false`; Bun development-mode bundle timing output corrupts the TUI rendering on the shared terminal fd

> **Note:** Running the TUI process and web server as separate long-lived processes against the same port is not the supported default flow anymore. Use `bun run start` unless you explicitly want a web-only or TUI-only mode.

## Configuration

This project splits runtime state across two files under `YASH_DATA_DIR` (default `~/.yash`). Do NOT commit either file.

On startup, YASH performs a one-time migration from the legacy repository-root `config.json` when that legacy file exists and the runtime config file does not yet exist. It also performs a one-time split migration that moves mutable runtime settings out of `config.json` into `settings.json`.

1. Copy `config.example.json` to your runtime config location and update bootstrap values that are local-only (OBS websocket password, provider credentials, stream keys, etc.).
   ```
   mkdir -p "${YASH_DATA_DIR:-$HOME/.yash}" && cp config.example.json "${YASH_DATA_DIR:-$HOME/.yash}/config.json"
   ```
2. Copy `settings.example.json` to your runtime settings location and update mutable defaults such as stream metadata, UI preferences, and YouTube setup flags.
   ```
   mkdir -p "${YASH_DATA_DIR:-$HOME/.yash}" && cp settings.example.json "${YASH_DATA_DIR:-$HOME/.yash}/settings.json"
   ```
3. If you already have a legacy repo-root `config.json`, YASH will migrate it once automatically the first time it starts without an existing runtime config file.

`config.json` holds rarely edited bootstrap data such as OBS, server, and provider credentials/setup fields. `settings.json` holds mutable runtime state such as `stream.*`, `platforms.youtube.setup`, chat/UI preferences, demo mode, and per-platform viewer display settings.

## Security

- `YASH_DATA_DIR/config.json`, `YASH_DATA_DIR/settings.json`, and the other files under `YASH_DATA_DIR` (default `~/.yash/`) should be treated as sensitive local secrets
- This repository is suitable for local or otherwise controlled environments, not as-is for broad public multi-tenant deployment
- If you expose the web server beyond localhost, you should add a reverse proxy / network ACL layer and explicit authentication controls around any sensitive endpoints

## Stream category autocomplete

The `/stream` modal (TUI) and stream form (WebUI) have per-platform category fields. Twitch and Kick fields autocomplete live as you type (300 ms debounce); YouTube uses a static dropdown. All three are sent as separate metadata fields (`twitchGame`, `kickCategory`, `youtubeCategory`).

## YouTube `/stream` targeting notes

- `/stream` may only update mutable YouTube broadcasts: `created`, `ready`, `testing`, or `live`
- Completed or revoked broadcasts are never valid update targets
- If no mutable broadcast exists for the configured stream key, YASH creates a fallback broadcast with `liveBroadcasts.insert`, binds it with `liveBroadcasts.bind`, and then applies the metadata update to that new broadcast
- Studio can create an unscheduled `ready` "Direct stream" broadcast with `snippet.scheduledStartTime = null`
- The public YouTube API does not expose that exact creation behavior: `liveBroadcasts.insert` requires a future `scheduledStartTime`, and using Unix epoch zero is rejected with `invalidScheduledStartTime`

## `/stream` validation and execution flow

```mermaid
flowchart TD
    A["User runs /stream in TUI or submits stream form in WebUI"] --> B["Collect selected platforms and metadata fields"]
    B --> C{"Any metadata changed?"}
    C -- No --> C1["Stop: no-op, report 'No changes'"]
    C -- Yes --> D["Persist merged stream metadata to YASH_DATA_DIR/settings.json"]
    D --> E["Call StreamService.setStreamMetadata(targetPlatforms, mergedMetadata)"]

    E --> F{"For each selected provider"}

    F --> Y["YouTube provider"]
    F --> T["Twitch provider"]
    F --> K["Kick provider"]

    T --> T1["Validate auth and resolve Twitch game/category by name"]
    T1 --> T2{"Validation/update result"}
    T2 -- Success --> T3["Return applied/skipped field details"]
    T2 -- Error --> T4["Return provider error"]

    K --> K1["Validate auth and resolve Kick category by name"]
    K1 --> K2{"Validation/update result"}
    K2 -- Success --> K3["Return applied/skipped field details"]
    K2 -- Error --> K4["Return provider error"]

    Y --> Y1["List own liveBroadcasts and current liveStreams"]
    Y1 --> Y2["Resolve saved YouTube stream key to streamId"]
    Y2 --> Y3["Filter broadcasts to mutable lifecycle states: created, ready, testing, live"]
    Y3 --> Y4{"Mutable broadcast bound to saved streamId exists?"}
    Y4 -- Yes --> Y5["Pick best mutable bound broadcast"]
    Y4 -- No --> Y6{"Any mutable broadcast exists at all?"}
    Y6 -- Yes --> Y7["Pick best mutable unbound/other broadcast"]
    Y6 -- No --> Y8{"saved streamId available?"}
    Y8 -- No --> Y13["Return warning: no broadcast target found + recent broadcast references"]
    Y8 -- Yes --> Y9["Create fallback broadcast via liveBroadcasts.insert"]
    Y9 --> Y10["Bind fallback broadcast to saved stream via liveBroadcasts.bind"]
    Y10 --> Y11["Return warning: fallback broadcast created"]
    Y11 --> Y5

    Y5 --> Y12["Update liveBroadcast snippet, then update video snippet/title/description/category/tags"]
    Y12 --> Y14{"Update result"}
    Y14 -- Success --> Y15["Return applied field details and optional warnings"]
    Y14 -- Error --> Y16["Return provider error"]

    T3 --> Z["Aggregate per-provider results"]
    T4 --> Z
    K3 --> Z
    K4 --> Z
    Y13 --> Z
    Y15 --> Z
    Y16 --> Z

    Z --> R{"Any provider errors?"}
    R -- No --> R1["Report per-provider success/warning results to UI"]
    R -- Yes --> R2["Report mixed success/error results to UI"]
```

**Notes:**
- YouTube completed/revoked broadcasts are never valid `/stream` update targets.
- If YouTube has no mutable target, YASH may create a fallback broadcast and bind it to the saved stream key before applying metadata.
- The public YouTube API does not reproduce Studio's unscheduled direct-stream sentinel exactly; fallback creation may briefly exist as an upcoming broadcast because `liveBroadcasts.insert` requires a future `scheduledStartTime`.

## OBS reconnection & backoff

You can tune the OBS websocket reconnection and backoff behaviour via environment variables or the runtime config file at `YASH_DATA_DIR/config.json` (default `~/.yash/config.json`, under `obs.websocket`). Environment variables take precedence and are useful for CI/runtime overrides.

**Environment variables:**

| Variable | Description | Default |
|---|---|---|
| `YASH_OBS_SERVER` | OBS websocket host | `localhost` |
| `YASH_OBS_PORT` | OBS websocket port | `4455` |
| `YASH_OBS_PASSWORD` | OBS websocket password | — |
| `YASH_OBS_RECONNECT_BASE_MS` | Base backoff delay in ms | `30000` |
| `YASH_OBS_RECONNECT_MAX_MS` | Maximum backoff cap in ms | `300000` (5 min) |
| `YASH_OBS_RECONNECT_MULTIPLIER` | Exponential multiplier | `2` |
| `YASH_OBS_RECONNECT_MAX_ATTEMPTS` | Maximum retry attempts | unlimited |
| `YASH_OBS_CONNECT_DELAY_MS` | Simulated connect delay in ms (testing) | `1000` |

**Example (env):**

```sh
export YASH_OBS_RECONNECT_BASE_MS=10000
export YASH_OBS_RECONNECT_MULTIPLIER=2
export YASH_OBS_RECONNECT_MAX_ATTEMPTS=10
```

**Example (`~/.yash/config.json`):**

```json
{
  "obs": {
    "websocket": {
      "server": "localhost",
      "port": "4455",
      "reconnectBaseMs": 10000,
      "reconnectMultiplier": 2,
      "reconnectMaxAttempts": 10
    }
  }
}
```

> **Note:** Values supplied via environment variables are parsed as strings and cast to numbers by the app where applicable.

## Kick webhook relay

When the Kick platform provider calls `setupWebhooks()`, the app starts a smee.io relay channel and logs the public relay URL to the console. Register that URL in your Kick developer app settings (under "Webhook URL") so Kick can deliver real-time chat events to your local instance.

The relay URL is also available at runtime via `GET /api/kick/webhook` (returns `{ url: string | null }`).
