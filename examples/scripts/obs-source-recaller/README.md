# obs-source-recaller

Example user script that remembers one OBS source's settings per scene and restores them automatically when the current program scene changes.

Actions:

- `obs.source-recaller.save source=<source>`
- `obs.source-recaller.load source=<source>`
- `obs.source-recaller.pause`
- `obs.source-recaller.resume`

Typical flow:

1. Install the example into `~/.config/yash/scripts/obs-source-recaller/`
2. Frame or crop your camera in one OBS scene
3. Run `/action obs.source-recaller.save source='Your Camera Source'`
4. Switch to another scene, adjust the same source differently, and save again
5. Leave the watcher active so later `CurrentProgramSceneChanged` events restore the matching snapshot automatically

State model:

- Static defaults live in `config.jsonc`
- Saved snapshots and pause/resume state persist under `settings.json` at `scripts.obs-source-recaller.state`

Notes:

- `load` restores the snapshot for the *active* OBS program scene only
- Automatic scene-change recalls can be temporarily disabled with `pause`
- `resume` re-enables recalls and immediately reapplies snapshots for the current scene when possible
