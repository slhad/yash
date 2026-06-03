# obs-scene-change

Minimal example user script for voice-triggered OBS scene switching.

Actions:

- `obs.scene-change.activate [scene=<scene>]`
- `obs.scene-change.config [defaultScene=<scene>]`
- `obs.scene-change.configTUI`

Typical flow:

1. Install the example into `~/.config/yash/scripts/obs-scene-change/`
2. Optionally set a default scene with `/action obs.scene-change.config defaultScene='BRB'`
3. Trigger `/action obs.scene-change.activate` from `yash-voice-bridge`, or pass an explicit scene with `/action obs.scene-change.activate scene='Starting Soon'`

Notes:

- `activate` requires OBS to be connected
- `activate` validates the target scene against the current OBS scene list before switching
- `config` and `configTUI` both read and write the same `config.jsonc` file
- `types.d.ts` is a local re-export of YASH's generated script types so editors and typecheckers can resolve `import type { ScriptApi } from './types'`
