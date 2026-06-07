# obs-audio-routing

Linux-first bundled example script that watches the focused Hyprland window and live PipeWire/PulseAudio streams, then auto-routes approved apps to virtual sinks named `Stream` and `Music`.

Actions:

- `obs-audio-routing.config`
- `obs-audio-routing.configTUI`
- `obs-audio-routing.status`
- `obs-audio-routing.candidates`
- `obs-audio-routing.search`

Notes:

- Initial scope is Linux + Hyprland + `pactl` / `ps`
- `config` and `configTUI` edit the persisted script-local `config.jsonc`
- `status` and `candidates` expose runtime-only state
- Unmatched apps stay on their current sink
- Candidates are runtime-only and disappear on restart
- The shipped example includes one enabled rule for `cliamp -> Stream`
