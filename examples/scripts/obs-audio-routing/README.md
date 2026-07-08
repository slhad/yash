# obs-audio-routing

Linux-first bundled example script that watches the focused Hyprland window and live PipeWire/PulseAudio streams, then auto-routes approved apps to virtual sinks named `Stream` and `Music`.

Actions:

- `obs-audio-routing.config`
- `obs-audio-routing.config.tui`
- `obs-audio-routing.config.open`
- `obs-audio-routing.actions`
- `obs-audio-routing.status`
- `obs-audio-routing.wiring [wait=<duration>]`
- `obs-audio-routing.candidates`
- `obs-audio-routing.search`
- `obs-audio-routing.addStreamTarget`
- `obs-audio-routing.addMusicTarget`
- `obs-audio-routing.restoreDefaultExclusions`
- `obs-audio-routing.repairDefaultExclusions`

Notes:

- Initial scope is Linux + Hyprland + `pactl` / `ps`
- `config`, `config.tui`, `config.open`, and `actions` are framework-owned actions injected by YASH
- `status` and `candidates` expose runtime-only state
- Unmatched apps stay on their current sink
- Candidates are runtime-only and disappear on restart
- Add persistent rules without editing JSON, for example:
  - `/action obs-audio-routing.addStreamTarget processBinary=google-chrome sourceSinkName=easyeffects_sink`
  - `/action obs-audio-routing.addMusicTarget processBinary=spotify`
- The shipped example includes one enabled rule for `cliamp -> Music`
