# obs-alerts

Bundled example script that reacts to YASH activity events from Twitch, Kick, and YouTube and drives OBS alert sources.

For each matching rule, the script sets the configured OBS text source to a rendered user name and then shows the scene item. It does **not** auto-hide by default, so OBS-side filters can hide the source.

Actions:

- `obs.alerts.config`
- `obs.alerts.config.tui`
- `obs.alerts.config.open`
- `obs.alerts.actions`
- `obs.alerts.list`
- `obs.alerts.add id=<id> platform=<twitch|kick|youtube> types=<csv> scene=<scene> source=<source> [textTemplate=<template>] [enabled=<true|false>] [replace=<true|false>]`
- `obs.alerts.add id=<id> platform=<twitch|kick|youtube> types=<csv> scene=<scene> textSource=<text-source> showSource=<animated-source> [textTemplate=<template>] [enabled=<true|false>] [replace=<true|false>]`
- `obs.alerts.remove id=<id>`
- `obs.alerts.enable id=<id> enabled=<true|false>`
- `obs.alerts.pause`
- `obs.alerts.resume`
- `obs.alerts.status`
- `obs.alerts.test id=<id> [user=<name>] [type=<event>] [platform=<platform>] [message=<text>]`

Autocomplete:

- `platform=` suggests `twitch`, `kick`, `youtube`
- `types=` suggests platform event names and supports comma-separated values
- `scene=` uses the `obs.scenes` provider
- `source=`, `textSource=`, and `showSource=` use the `obs.sceneSources` provider scoped by `scene=`

Example:

Simple one-source setup:

```text
/action obs.alerts.add id=twitch-follow platform=twitch types=follow scene=Alerts source="Follower Name"
/action obs.alerts.test id=twitch-follow user=TestUser
```

Split text/animation setup:

```text
/action obs.alerts.add id=twitch-follow platform=twitch types=follow scene=Alerts textSource="Follower Text" showSource="Follower Animation"
/action obs.alerts.test id=twitch-follow user=TestUser
```

Rule shape in `config.jsonc`:

```jsonc
{
  "enabled": true,
  "rules": [
    {
      "id": "twitch-follow",
      "enabled": true,
      "platform": "twitch",
      "types": ["follow"],
      "scene": "Alerts",
      "source": "Follower Name",
      "textTemplate": "{user}"
    }
  ]
}
```

For setups where the text input and animated/show item are different sources, use:

```jsonc
{
  "scene": "Alerts",
  "textSource": "Follower Text",
  "showSource": "Follower Animation",
  "textTemplate": "{user}"
}
```

`source` remains as a shorthand fallback for both `textSource` and `showSource`.

Template placeholders:

- `{user}` / `{username}` — activity username, or `someone`
- `{platform}` — `twitch`, `kick`, or `youtube`
- `{type}` — normalized activity event type
- `{message}` — YASH activity message

Known event types include:

- Twitch: `follow`, `sub`, `subscription`, `cheer`, `raid`
- Kick: `follow`, `sub`, `subscription`, `gift`
- YouTube: `member`, `subscriber`, `sponsor`, `gift`, `superchat`, `like`

Live activity events emitted before the script is loaded are not replayed.
