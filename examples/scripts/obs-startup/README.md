# obs-startup

A yash user script that runs your stream startup sequence as an async 5-phase pipeline:
**prepare → pre-start wait → stream start → countdown → go live**.

Registers three actions: `obs.startup.begin`, `obs.startup.cancel`, and `obs.startup.status`.

## Install

Symlink the script and config into your yash scripts directory, then restart yash:

```bash
mkdir -p ~/.config/yash/scripts/obs-startup
ln -s ~/dev/git/yash/examples/scripts/obs-startup/index.ts \
      ~/.config/yash/scripts/obs-startup/index.ts
ln -s ~/dev/git/yash/examples/scripts/obs-startup/config.jsonc \
      ~/.config/yash/scripts/obs-startup/config.jsonc
```

> **Types note:** `index.ts` imports `./types`, which resolves to the yash-generated
> `~/.config/yash/scripts/types.d.ts` at runtime. There is no `types.d.ts` in this
> folder — you do not need to create one.

## Configure

Edit `config.jsonc` (or the symlinked copy in `~/.config/yash/scripts/obs-startup/`):

### Prepare phase

| Key | Default | Description |
|---|---|---|
| `prepareScene` | `"Starting Soon"` | OBS scene to switch to immediately on startup (required) |
| `hideSources` | `[]` | Scene items to disable. Each entry can be either `<source>` for the prepare scene or `<scene>.<source>` to target a different scene explicitly |
| `muteSources` | `[]` | Audio inputs to mute during prepare |

### Stream start phase

| Key | Default | Description |
|---|---|---|
| `startStream` | `false` | Whether to call OBS `startStream` automatically. Left `false` by default — start the stream manually or via a separate yash command when you are ready |
| `preStartDelay` | `0` | Optional safety wait in seconds before calling OBS `startStream`. Useful when you want a short cancel window after the prepare scene is already active |

### Countdown phase

| Key | Default | Description |
|---|---|---|
| `countdownDelay` | `0` | Seconds to wait before switching to the live scene. `0` skips the countdown entirely |
| `countdownSource` | `""` | OBS text input source to update with remaining time on each tick. Accepts either `<source>` or `<scene>.<source>`; the scene prefix is only used to resolve the intended source name. Leave empty to disable |
| `countdownSourceText` | `"{remaining}s"` | Template written to the text source — `{remaining}` is replaced with the seconds left |

### Go-live phase

| Key | Default | Description |
|---|---|---|
| `liveScene` | `"Live"` | OBS scene to switch to when going live (required) |
| `showSources` | `[]` | Scene items to enable. Each entry can be either `<source>` for the live scene or `<scene>.<source>` to target a different scene explicitly |
| `unmuteSources` | `[]` | Audio inputs to unmute when going live |
| `liveMessage` | `"We're live!"` | Chat message sent when going live. Set to `""` to disable |

## Actions

### `obs.startup.begin`

Kicks off the startup sequence. Returns immediately after the prepare phase begins; the countdown and go-live phases run in the background. Can only be called once per sequence — if a sequence is already running, it returns an error.

**Arg overrides** (all optional — override the corresponding config key for this call only):

| Arg | Config key overridden |
|---|---|
| `prepareScene` | `prepareScene` |
| `liveScene` | `liveScene` |
| `preStartDelay` | `preStartDelay` |
| `delay` | `countdownDelay` |
| `startStream` | `startStream` |
| `countdownSource` | `countdownSource` |
| `sourceText` | `countdownSourceText` |
| `chatMessage` | `liveMessage` |

### `obs.startup.cancel`

Cancels the in-progress sequence at whatever phase it is currently in. The prepare scene switch is **not** rolled back — cancelling does not restore the previous scene or re-mute sources.

`hideSources`, `showSources`, and `countdownSource` support explicit `scene.source` references. `muteSources` and `unmuteSources` do not — they still expect plain OBS input names because muting is not scene-specific.

### `obs.startup.status`

Returns the current state: whether a sequence is active, which phase it is in, and how many seconds remain in the countdown (if applicable).

## Usage examples

From the yash TUI command bar (using `/action <id>` syntax):

```
/action obs.startup.begin
/action obs.startup.begin preStartDelay=15 startStream=true
/action obs.startup.begin delay=30
/action obs.startup.begin startStream=true
/action obs.startup.begin prepareScene="Starting Soon" liveScene="Main"
/action obs.startup.begin delay=60 chatMessage=""
/action obs.startup.cancel
/action obs.startup.status
```

## Sequence overview

```
obs.startup.begin
  │
  ├─ [prepare]      Switch to prepareScene
  │                 Hide hideSources in prepareScene
  │                 Mute muteSources
  │
  ├─ [pre-start-wait]
  │                 Wait preStartDelay seconds before calling OBS startStream
  │                 (skipped unless startStream: true and preStartDelay > 0)
  │
  ├─ [stream-start] Start OBS stream (only if startStream: true)
  │
  ├─ [countdown]    Wait countdownDelay seconds, ticking countdownSource each second
  │                 (skipped if countdownDelay is 0)
  │
  └─ [go-live]      Switch to liveScene
                    Show showSources in liveScene
                    Unmute unmuteSources
                    Send liveMessage to chat
```

`obs.startup.cancel` can interrupt the sequence at any phase during the countdown.
Once the sequence reaches go-live it completes synchronously and cannot be cancelled.
