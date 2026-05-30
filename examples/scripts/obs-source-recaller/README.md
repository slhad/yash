# obs-source-recaller

Example user script that remembers one OBS source's settings per scene and restores them automatically when the current program scene changes.

Actions:

- `obs.source-recaller.config [startPaused=<true|false>]`
- `obs.source-recaller.configTUI`
- `obs.source-recaller.save source=<source|scene.source> [stage=<inputSettings|sceneItemTransform|sceneItemEnabled>]`
- `obs.source-recaller.load source=<source|scene.source>`
- `obs.source-recaller.list`
- `obs.source-recaller.explore`
- `obs.source-recaller.pause`
- `obs.source-recaller.resume`

Typical flow:

1. Install the example into `~/.config/yash/scripts/obs-source-recaller/`
2. Frame or crop your camera in one OBS scene
3. Run `/action obs.source-recaller.explore` to list source names in the current scene
4. Run `/action obs.source-recaller.save source='Your Camera Source'`
5. If you only want to refresh one restore stage, use `/action obs.source-recaller.save source='Your Camera Source' stage='sceneItemTransform'`
6. Switch to another scene, adjust the same source differently, and save again
7. If needed, target another scene or nested/keyed source directly with `/action obs.source-recaller.save source='Starting Soon.Your Camera Source'`
8. The active OBS scene remains the trigger scene; the explicit `scene.source` only changes which source gets captured or restored
9. Leave the watcher active so later `CurrentProgramSceneChanged` events restore the matching snapshot automatically

State model:

- Static defaults, runtime overrides, pause state, and saved snapshots all live in `config.jsonc`
- `obs.source-recaller.config` and `configTUI` update that same file
- Scene snapshot saves/loads also read and write that same file
- A reserved top-level `"$ui"` object can live in that same file to describe how the generic TUI editor should render labels, widget hints, ordering, help text, and wildcard row templates for nested objects/arrays
- In the current generic editor, `triggers` is rendered as a recursive tree of trigger scenes, array entries, and scalar leaf fields rather than one raw JSON line; scalar leaves use compact `key: type = value` rows
- Runtime snapshot data is stored as a `triggers` map from scene name to restore operations:

```json
{
  "paused": false,
  "triggers": {
    "Gameplay": [
      {
        "sourceRef": "Gameplay.Overlay",
        "stage": "inputSettings",
        "priority": 10,
        "data": { "...": "..." }
      },
      {
        "sourceRef": "Gameplay.Overlay",
        "stage": "sceneItemTransform",
        "priority": 20,
        "data": { "...": "..." }
      },
      {
        "sourceRef": "Gameplay.Overlay",
        "stage": "sceneItemEnabled",
        "priority": 30,
        "data": true
      }
    ]
  }
}
```

Ordering rules:

- Saving a source without `stage=` replaces every existing operation for that same target `scene.source` inside the active trigger scene's `triggers` array, then appends the new staged operations at the end
- Saving with `stage=` replaces only that stage for the target `scene.source` and keeps the other stored stages untouched
- Scene recalls do not apply one source as a single blob anymore
- Instead, recall expands each saved source into staged operations and runs all sources in deterministic priority order:
  1. `inputSettings`
  2. `sceneItemTransform`
  3. `sceneItemEnabled`
- Within the same stage, sources run in the saved source order implied by each scene's `triggers` array

Notes:

- `config` shows or updates the effective `startPaused` setting
- `configTUI` edits `startPaused`, top-level `paused`, and the `triggers` JSON map from the live TUI
- The shipped example `config.jsonc` includes `"triggers/*/*": { "titleTemplate": "${index} - ${sourceRef} : ${stage}" }` so each staged restore operation is labeled with its source and stage instead of a generic `0 - object`
- In the generic TUI editor, focus an operation header row to reorder it with `[` (up) / `]` (down) or delete it with `x`; those edits stay local until you save
- `load` restores the snapshot for the active OBS trigger scene; passing an explicit `scene.source` changes the targeted source, not the trigger scene
- Automatic scene-change recalls can be temporarily disabled with `pause`
- `resume` re-enables recalls and immediately reapplies snapshots for the current scene when possible
- `types.d.ts` is a local re-export of YASH's generated script types so editors and typecheckers can resolve `import type { ScriptApi } from './types'`
