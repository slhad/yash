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
- `bun run cmd <command>` sends a command to a running TUI process via IPC (see [CLI IPC](#cli-ipc) below)
- `bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts --file tmp/<artifact>.mp4 [--pr <number|url>]` uploads a local proof artifact through GitHub's PR editor and prints a `github.com/user-attachments/...` URL that GitHub will inline in the PR body
- `Bun.serve` intentionally uses `development: false`; Bun development-mode bundle timing output corrupts the TUI rendering on the shared terminal fd

> **Note:** Running the TUI process and web server as separate long-lived processes against the same port is not the supported default flow anymore. Use `bun run start` unless you explicitly want a web-only or TUI-only mode.

## CLI IPC

When a TUI process is running, it listens on a Unix Domain Socket at `YASH_DATA_DIR/yash.sock` (default `~/.config/yash/yash.sock`). The `bun run cmd` script connects to that socket, sends a command, prints the response, and exits.

```sh
bun run cmd /action          # list public IPC-safe actions
bun run cmd /marker          # drop a stream marker
bun run cmd /marker "Replay | -300"  # 5 minutes before the current live position
bun run cmd /marker "Boss | 32:44"   # 32 minutes 44 seconds from stream start
bun run cmd /markers         # list all markers
bun run cmd /markers restore twitch
bun run cmd /settings get stream.title
bun run cmd /settings set demo true
bun run cmd /connect youtube
bun run cmd /msg all Hello chat
bun run cmd /help
bun run cmd /scripts list
bun run cmd /scripts install obs-source-recaller
```

Both forms are accepted — `bun run cmd marker` and `bun run cmd /marker` are equivalent; the leading `/` is added automatically if omitted.

`/marker` accepts raw seconds as before, and also `mm:ss` or `hh:mm:ss` timestamps for YouTube chapters.

`/markers restore twitch [limit]` imports recent Twitch markers into persisted YouTube chapters, but only when that marker text is missing from YouTube already. Persisted YouTube chapters stay sorted by timestamp so `/markers`, edit, and clear IDs remain stable after imports.

Commands invoked over IPC are also echoed into the live TUI chat pane before their output, using an `[ipc → cmd] /...` line. The same command echo exists for typed slash commands inside the TUI as `[you → cmd] /...`.

**Exit behaviour:**
- Exits `0` with stdout output on success
- Exits `1` and prints the error string to stderr on command error
- Exits `1` and prints `yash is not running` when the socket is absent or the connection is refused

**Commands blocked over IPC** (return an error string instead of executing):

| Command | Reason |
|---|---|
| `/exit` | Cannot terminate the TUI remotely |
| `/stream` | Requires TUI modal interaction |
| `/setup-youtube` | Requires TUI modal interaction |
| `/history` | Requires TUI modal interaction |
| `/activity` | Requires TUI modal interaction |
| `/chatter` | Requires TUI modal interaction |
| `/inject` | TUI-only dev/testing helper |
| `/settings` (bare) | Requires TUI settings modal |

`/settings get <key>` and `/settings set <key> <value>` work normally over IPC.

### Bundled example scripts

YASH ships a small catalog of tracked example user scripts under `examples/scripts/`, and the live TUI/IPC command surface can copy them into your runtime script directory without manual symlinks:

```sh
bun run cmd /scripts list
bun run cmd /scripts install obs-startup
bun run cmd /scripts install obs-source-recaller
bun run cmd /scripts install obs-source-recaller repair
```

- Install target: `${YASH_DATA_DIR}/scripts/<example-id>/`
- Existing files are never overwritten; install aborts if any target file already exists
- Use `repair` (or `force`) to refresh tracked files intentionally for a partial or outdated install
- Repair merges the shipped `config.jsonc` defaults with your current `config.jsonc`, preserving your existing values and unknown keys
- Restart YASH after install so the copied script is loaded at startup

### `/action` command

`/action` exposes public IPC-safe actions from the internal action registry.

```sh
bun run cmd /action
bun run cmd /action marker.create timestamp=-300
bun run cmd /action obs.shutdown.initiate
bun run cmd /action obs.shutdown.initiate delay=10 scene='[PS] End'
```

- `/action` with no action id lists public actions grouped by domain
- `/action <id>` invokes the action directly when all args are optional
- `/action <id>` shows help and examples when required args are still missing
- `/action <id> key=value ...` parses typed args and invokes the action

The TUI autocomplete also understands `/action`, including action ids, `key=` argument names, and enum values. Matches are fuzzy-ranked: prefix matches win, then substring matches, then subsequence matches.

**Stale socket cleanup:** the server removes any pre-existing socket file at startup, so a leftover socket from a crash does not block a new TUI launch.

### IPC round-trip flow

```mermaid
flowchart TD
    A(["bun run cmd &lt;command&gt;\nsrc/cli.ts"]) --> B["Normalise\n(prepend '/' if missing)"]
    B --> C["sendCliCommand\nsrc/ipc/client.ts"]
    C --> D["net.createConnection\n$YASH_DATA_DIR/yash.sock"]

    D -->|"ENOENT / ECONNREFUSED"| E["stderr: 'yash is not running'\nexit 1"]
    D -->|"connected"| F["Write JSON request\n{command: '/foo bar'}"]

    F --> G[["yash TUI process\nsrc/ipc/server.ts"]]
    G --> H["Buffer until newline\nparse JSON"]
    H --> I["handleCommandForCli\nsrc/index.tsx"]

    I -->|"/exit"| J["'Cannot exit the TUI via IPC'"]
    I -->|"TUI-only cmd\n(/stream /history etc.)"| K["'This command requires the TUI'"]
    I -->|"unknown cmd"| L["'Unknown command: ...'"]
    I -->|"valid cmd"| M["commandHandlers#91;cmd#93;(parts, emit)\ncollect lines → join"]

    J --> N["Write {ok: false, error}"]
    K --> N
    L --> O["Write {ok: true, output}"]
    M --> O

    N --> P["socket.end()"]
    O --> P

    P --> Q["client reads response"]
    Q -->|"ok: true"| R["stdout: output / exit 0"]
    Q -->|"ok: false"| S["stderr: error / exit 1"]
    Q -->|"parse failure"| T["'Invalid response' / exit 1"]

    R --> U["client.end()"]
    S --> U
    T --> U

    style E fill:#c0392b,color:#fff
    style N fill:#e67e22,color:#fff
    style R fill:#27ae60,color:#fff
    style S fill:#c0392b,color:#fff
    style T fill:#c0392b,color:#fff
    style G fill:#2980b9,color:#fff
```

## Configuration

This project splits runtime state across two files under `YASH_DATA_DIR` (default `~/.config/yash`). Do NOT commit either file.

On startup, YASH performs a one-time migration from the legacy repository-root `config.json` when that legacy file exists and the runtime config file does not yet exist. It also performs a one-time split migration that moves mutable runtime settings out of `config.json` into `settings.json`.

1. Copy `config.example.json` to your runtime config location and update bootstrap values that are local-only (OBS websocket password, provider credentials, stream keys, etc.).
   ```
   mkdir -p "${YASH_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/yash}" && cp config.example.json "${YASH_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/yash}/config.json"
   ```
2. Copy `settings.example.json` to your runtime settings location and update mutable defaults such as stream metadata, UI preferences, and YouTube setup flags.
   ```
   mkdir -p "${YASH_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/yash}" && cp settings.example.json "${YASH_DATA_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/yash}/settings.json"
   ```
3. If you already have a legacy repo-root `config.json`, YASH will migrate it once automatically the first time it starts without an existing runtime config file.

`config.json` holds rarely edited bootstrap data such as OBS, server, and provider credentials/setup fields. `settings.json` holds mutable YASH-owned runtime state such as `stream.*`, `platforms.youtube.setup`, chat/UI preferences, demo mode, and per-platform viewer display settings.

Ownership boundary:

- `YASH_DATA_DIR/config.json`, `YASH_DATA_DIR/settings.json`, tokens, logs, the message DB, and the IPC socket are YASH-owned files
- User scripts own `YASH_DATA_DIR/scripts/<scriptId>/`
- A script's editable config lives at `YASH_DATA_DIR/scripts/<scriptId>/config.jsonc`
- A script's private runtime state should live beside that config inside the same script folder, typically as `state.json`, not in YASH's top-level `settings.json`

## Script configuration

Bundled and user scripts use a dedicated per-script folder at `~/.config/yash/scripts/<scriptId>/`.

The standard editable config file is `config.jsonc` inside that folder:

For example, the bundled `obs-shutdown` action can be configured at:

```jsonc
// ~/.config/yash/scripts/obs-shutdown/config.jsonc
{
  "delay": 10,
  "chatInterval": 10,
  "stopStream": true,
  "scene": "[PS] End",
  "message": "Stream ending in {remaining}s!",
  "source": "[TXT] Countdown",
  "sourceText": "{remaining}s",
  "hideSources": ["Gameplay.Camera"],
  "muteSources": ["Mic/Aux"]
}
```

That lets `/action obs.shutdown.initiate` run with config-backed defaults, optionally keep an OBS text source updated during the countdown, and choose whether the countdown should actually stop the OBS stream when it reaches zero.

`source` accepts either `<source>` or `<scene>.<source>`. The scene qualifier is only used to resolve the intended source name before OBS text updates, because the text update itself still applies to the underlying source globally. `hideSources` accepts the same two forms: plain `<source>` searches every scene, while explicit `<scene>.<source>` only hides and restores that one scene item.

Keep any script-private runtime data, caches, or snapshots inside the same `YASH_DATA_DIR/scripts/<scriptId>/` folder so ownership stays local to that script and YASH's own `config.json` / `settings.json` remain reserved for the app itself. The standard mutable runtime file for scripts is `YASH_DATA_DIR/scripts/<scriptId>/state.json`.

Pre-v1 note:

- YASH does not guarantee migration of old user-script runtime state layouts
- Script/runtime data format changes may require reinstalling or resetting a script's local `state.json`

## Example script: `obs-source-recaller`

The bundled `obs-source-recaller` example remembers one OBS source's settings per scene and automatically restores matching snapshots on `CurrentProgramSceneChanged`.

Actions:

- `obs.source-recaller.save source=<source|scene.source>`
- `obs.source-recaller.load source=<source|scene.source>`
- `obs.source-recaller.list`
- `obs.source-recaller.explore`
- `obs.source-recaller.pause`
- `obs.source-recaller.resume`

Typical flow:

1. Install it with `bun run cmd /scripts install obs-source-recaller`
2. Run `/action obs.source-recaller.explore` to list source names in the current scene
3. Adjust a source in one OBS scene and run `/action obs.source-recaller.save source='Camera'`
4. Switch to another scene, adjust the same source differently, and save again
5. If needed, target another scene directly with `/action obs.source-recaller.save source='Starting Soon.Camera'`
6. Use `/action obs.source-recaller.list` to see which saved sources match the current OBS program scene
7. Leave the watcher active so later scene changes restore the matching snapshot automatically

Notes:

- `load` restores the saved snapshot for the current OBS program scene unless you pass an explicit `scene.source` reference
- `pause` disables automatic scene-change recalls without deleting saved snapshots
- `resume` re-enables recalls and, when OBS is connected, immediately reapplies any matching snapshots for the current scene
- The shipped `config.jsonc` currently exposes `startPaused`; any runtime files the script needs should stay under `YASH_DATA_DIR/scripts/obs-source-recaller/`

## Security

- `YASH_DATA_DIR/config.json`, `YASH_DATA_DIR/settings.json`, and the other files under `YASH_DATA_DIR` (default `~/.config/yash/`) should be treated as sensitive local secrets
- This repository is suitable for local or otherwise controlled environments, not as-is for broad public multi-tenant deployment
- If you expose the web server beyond localhost, you should add a reverse proxy / network ACL layer and explicit authentication controls around any sensitive endpoints

## Stream category autocomplete

The `/stream` modal (TUI) and stream form (WebUI) have per-platform category fields. Twitch and Kick fields autocomplete live as you type (300 ms debounce); YouTube uses a static dropdown. All three are sent as separate metadata fields (`twitchGame`, `kickCategory`, `youtubeCategory`).

## HTML chat emotes

The WebUI chat surfaces at `/`, `/unified`, and `/sidebyside` render Twitch FrankerFaceZ emotes inline when YASH knows the authenticated Twitch channel login. The browser fetches a cached emote map from `GET /api/twitch/ffz-emotes`; persisted chat messages remain plain text, and only the WebUI rendering layer swaps matching Twitch tokens for emote images.

## TUI chat emotes

The TUI uses the same cached FrankerFaceZ map for Twitch messages, but keeps substitution as a render-time concern so persisted chat history stays plain text. When the active terminal supports Kitty-style Unicode image placeholders, YASH swaps matching Twitch tokens inline in the main Chat pane and the chatter/history modal message rows; verified on Ghostty through tmux with `allow-passthrough on` or `allow-passthrough all`. On terminals without that support, YASH leaves the original token text visible instead of breaking layout.

You can scale TUI emotes with `tui.emotes.scale` in `settings.json` or through `/settings set tui.emotes.scale <percent>`. `100` keeps the default size, `150` makes them larger, and the live TUI reuploads the inline images immediately after the setting changes.

If you tried `tui.emotes.scale` before the sizing fix on this branch, revisit your saved value. Visible growth now happens in terminal cell spans, so you may want a larger setting such as `200` or `400` for a more obvious change.

## PR proof uploads

GitHub only renders inline PR videos reliably when the body contains a `https://github.com/user-attachments/assets/...` URL. Release asset URLs from `gh release upload` remain useful as downloadable artifacts, but GitHub usually treats them as plain links instead of rendering embedded video blocks.

Use the global GitHub PR attachment helper when you need an inline PR video:

```sh
bun ~/.agents/skills/github-pr-attachments/scripts/upload_pr_attachment.ts --pr 35 --file tmp/ffz-web.mp4
```

- The script reuses the shared persistent Playwright browser profile at `~/.cache/codex/github-pr-attachments/playwright-profile`
- If that profile is not logged in yet, sign in once in the opened browser window and rerun or let the script continue
- The helper uploads through the PR conversation editor, extracts the `user-attachments` URL, and prints it
- Add that raw URL on its own line in the PR body so GitHub renders the inline video
- For templated PR bodies, use `--mode apply --placeholder __ATTACHMENT_URL__` to patch the live PR body through `gh pr edit`

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

    Y --> Y1["List own liveBroadcasts; resolve saved stream key to streamId via API"]
    Y1 --> Y3["Filter broadcasts to mutable lifecycle states: created, ready, testing, live"]
    Y3 --> Y4{"Any broadcast (mutable or not) bound to saved streamId?"}
    Y4 -- Yes --> Y5["Pick best mutable broadcast bound to that streamId"]
    Y4 -- No --> Y6{"Any mutable broadcast exists at all?"}
    Y6 -- Yes --> Y7["Pick best mutable broadcast (unbound or other)"]
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

YASH keeps retrying OBS websocket connections both after an established connection drops and when OBS was unavailable during app startup. You can tune that reconnection and backoff behaviour via environment variables or the runtime config file at `YASH_DATA_DIR/config.json` (default `~/.config/yash/config.json`, under `obs.websocket`). Environment variables take precedence and are useful for CI/runtime overrides.

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

**Example (`~/.config/yash/config.json`):**

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
