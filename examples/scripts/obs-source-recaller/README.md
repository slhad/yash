# obs-source-recaller

Example user script that remembers one OBS source's settings per scene and restores them automatically when the current program scene changes.

Actions:

- `obs.source-recaller.save source=<source|scene.source>`
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
5. Switch to another scene, adjust the same source differently, and save again
6. If needed, target another scene directly with `/action obs.source-recaller.save source='Starting Soon.Your Camera Source'`
7. Leave the watcher active so later `CurrentProgramSceneChanged` events restore the matching snapshot automatically

State model:

- Static defaults live in `config.jsonc`
- Saved snapshots and pause/resume state persist in `~/.config/yash/scripts/obs-source-recaller/state.json`
- Runtime snapshot data is stored scene-first:

```json
{
  "state": {
    "paused": false,
    "scenes": {
      "Gameplay": {
        "entries": [
          {
            "sourceName": "Overlay",
            "inputSettings": { "...": "..." },
            "sceneItemEnabled": true,
            "sceneItemTransform": { "...": "..." }
          },
          {
            "sourceName": "Camera",
            "inputSettings": { "...": "..." },
            "sceneItemEnabled": true,
            "sceneItemTransform": { "...": "..." }
          }
        ]
      }
    }
  }
}
```

Ordering rules:

- Each scene keeps an ordered `entries` array; saving a new source appends it, saving an existing source updates it in place without changing its position
- Scene recalls do not apply one source as a single blob anymore
- Instead, recall expands each saved source into staged operations and runs all sources in deterministic priority order:
  1. `inputSettings`
  2. `sceneItemTransform`
  3. `sceneItemEnabled`
- Within the same stage, sources run in the saved `entries` order
- Older source-first saved state is still accepted and normalized at runtime

Notes:

- `load` restores the snapshot for the active OBS program scene unless you pass an explicit `scene.source` target
- Automatic scene-change recalls can be temporarily disabled with `pause`
- `resume` re-enables recalls and immediately reapplies snapshots for the current scene when possible
