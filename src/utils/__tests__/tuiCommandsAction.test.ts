import { beforeEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '../../actions/registry';
import type { YashActionDefinition } from '../../actions/types';
import { clearActionAutocompleteCaches, setActionAutocompleteRuntime } from '../actionAutocomplete';
import { getAutocomplete, setActionRegistry } from '../tuiCommands';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(
  id: string,
  overrides: Partial<YashActionDefinition> = {},
): YashActionDefinition {
  return {
    id,
    title: id,
    description: id,
    domain: 'system',
    ipcEnabled: true,
    readOnly: true,
    safety: 'safe',
    visibility: 'public',
    args: {},
    invoke: async () => ({ output: [] }),
    ...overrides,
  };
}

function buildRegistry(): ActionRegistry {
  const reg = new ActionRegistry();

  reg.registerAction(
    makeAction('obs.shutdown.initiate', {
      domain: 'obs',
      visibility: 'public',
      safety: 'safe',
      args: {
        delay: { type: 'number', min: 10, max: 3600 },
        scene: {
          type: 'string',
          maxLength: 200,
          autocomplete: {
            type: 'provider',
            providerId: 'obs.scenes',
          },
        },
        hideSources: {
          type: 'string',
          maxLength: 2000,
          autocomplete: {
            type: 'provider',
            providerId: 'obs.sceneSources',
            params: {
              includeQualifiedRefs: true,
              sceneArg: 'scene',
              valueMode: 'csv',
            },
          },
        },
      },
    }),
  );

  reg.registerAction(
    makeAction('obs.shutdown.cancel', {
      domain: 'obs',
      visibility: 'public',
      safety: 'safe',
      args: {},
    }),
  );

  reg.registerAction(
    makeAction('obs.shutdown.config', {
      domain: 'obs',
      visibility: 'public',
      safety: 'safe',
      args: {
        delay: { type: 'number', min: 10, max: 3600 },
        scene: { type: 'string', maxLength: 200 },
      },
    }),
  );

  reg.registerAction(
    makeAction('obs.shutdown.configTUI', {
      domain: 'obs',
      visibility: 'public',
      safety: 'safe',
      ipcEnabled: false,
      args: {},
    }),
  );

  reg.registerAction(
    makeAction('chat.send', {
      domain: 'chat',
      visibility: 'public',
      safety: 'safe',
      args: {
        platform: { type: 'enum', values: ['twitch', 'youtube', 'kick'] },
        text: { type: 'string', required: true, maxLength: 500 },
      },
    }),
  );

  reg.registerAction(
    makeAction('obs.source-recaller.save', {
      domain: 'obs',
      visibility: 'public',
      safety: 'safe',
      args: {
        source: {
          type: 'string',
          required: true,
          maxLength: 200,
          autocomplete: {
            type: 'provider',
            providerId: 'obs.sceneSources',
            params: {
              includeQualifiedRefs: true,
            },
          },
        },
        stage: {
          type: 'enum',
          values: ['inputSettings', 'sceneItemTransform', 'sceneItemEnabled'],
        },
      },
    }),
  );

  reg.registerAction(
    makeAction('internal.thing', {
      domain: 'system',
      visibility: 'internal',
      safety: 'safe',
    }),
  );

  reg.registerAction(
    makeAction('blocked.action', {
      domain: 'system',
      visibility: 'public',
      safety: 'blocked',
    }),
  );

  return reg;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getAutocomplete /action branch', () => {
  beforeEach(() => {
    setActionRegistry(buildRegistry());
    clearActionAutocompleteCaches();
    setActionAutocompleteRuntime({
      getObsConnectionState: () => true,
      getObsCurrentScene: async () => '[PS] PrimaryScreen',
      getObsSceneList: async () => ({
        scenes: [{ sceneName: '[PS] PrimaryScreen' }, { sceneName: '[SS] Common' }],
      }),
      getObsSceneItemList: async (sceneName: string) =>
        sceneName === '[SS] Common'
          ? [{ sourceName: 'Browser' }, { sourceName: 'Overlay' }]
          : [{ sourceName: 'Browser' }, { sourceName: 'Chat Box' }],
    });
  });

  // ── Registry not injected ─────────────────────────────────────────────────

  describe('registry not injected', () => {
    test('null registry → empty result', () => {
      setActionRegistry(null as unknown as ActionRegistry);
      expect(getAutocomplete('/action ')).toEqual({
        completion: null,
        hints: [],
        completions: [],
      });
    });
  });

  // ── Sub-case A: completing action id ──────────────────────────────────────

  describe('Sub-case A: completing action id', () => {
    test('/action <space> → hints contain all public non-blocked actions', () => {
      const result = getAutocomplete('/action ');
      expect(result.hints).toContain('obs.shutdown.initiate');
      expect(result.hints).toContain('obs.shutdown.cancel');
      expect(result.hints).toContain('chat.send');
      expect(result.hints).not.toContain('internal.thing');
      expect(result.hints).not.toContain('blocked.action');
    });

    test('/action obs → hints contain only obs.* actions', () => {
      const result = getAutocomplete('/action obs');
      expect(result.hints).toContain('obs.shutdown.initiate');
      expect(result.hints).toContain('obs.shutdown.cancel');
      expect(result.hints).not.toContain('chat.send');
      expect(result.hints).not.toContain('internal.thing');
      expect(result.hints).not.toContain('blocked.action');
    });

    test('/action obs.shutdown.i → completes to full id, single hint', () => {
      const result = getAutocomplete('/action obs.shutdown.i');
      expect(result.completion).toBe('/action obs.shutdown.initiate');
      expect(result.hints[0]).toBe('obs.shutdown.initiate');
    });

    test('/action osi → completes to obs.shutdown.initiate via fuzzy subsequence match', () => {
      const result = getAutocomplete('/action osi');
      expect(result.hints[0]).toBe('obs.shutdown.initiate');
      expect(result.hints[0]).toBe('obs.shutdown.initiate');
    });

    test('/action obs.shutdown. → hints contain both obs.shutdown.* actions', () => {
      const result = getAutocomplete('/action obs.shutdown.');
      expect(result.hints).toContain('obs.shutdown.initiate');
      expect(result.hints).toContain('obs.shutdown.cancel');
      expect(result.hints).toContain('obs.shutdown.config');
      expect(result.hints).toContain('obs.shutdown.configTUI');
    });

    test('/action obs.shutdown.c → hints prefer config actions', () => {
      const result = getAutocomplete('/action obs.shutdown.c');
      expect(result.hints).toContain('obs.shutdown.config');
      expect(result.hints).toContain('obs.shutdown.configTUI');
    });

    test('/action xyz → empty (no match)', () => {
      const result = getAutocomplete('/action xyz');
      expect(result).toEqual({ completion: null, hints: [], completions: [] });
    });

    test('/action obs.source-recaller.save → transitions into arg completion without requiring a trailing space', () => {
      const result = getAutocomplete('/action obs.source-recaller.save');
      expect(result.completion).toBe('/action obs.source-recaller.save ');
      expect(result.hints).toContain('source=');
      expect(result.hints).toContain('stage=');
    });
  });

  // ── Sub-case B: completing arg names ──────────────────────────────────────

  describe('Sub-case B: completing arg names', () => {
    test('/action obs.shutdown.initiate <space> → hints contain delay= and scene=', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate ');
      expect(result.hints).toContain('delay=');
      expect(result.hints).toContain('scene=');
    });

    test('/action obs.shutdown.initiate de → completes to delay=, single hint', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate de');
      expect(result.completion).toBe('/action obs.shutdown.initiate delay=');
      expect(result.hints[0]).toBe('delay=');
      expect(result.hints).toContain('hideSources=');
    });

    test('/action obs.shutdown.initiate dly → completes to delay= via fuzzy subsequence match', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate dly');
      expect(result.completion).toBe('/action obs.shutdown.initiate delay=');
      expect(result.hints[0]).toBe('delay=');
    });

    test('/action obs.shutdown.initiate delay=30 <space> → hints contain scene= but not delay=', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate delay=30 ');
      expect(result.hints).toContain('scene=');
      expect(result.hints).not.toContain('delay=');
    });

    test('/action obs.shutdown.initiate delay=30 sc → treats trailing token as next arg name', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate delay=30 sc');
      expect(result.completion).toBe('/action obs.shutdown.initiate delay=30 scene=');
      expect(result.hints).toContain('scene=');
      expect(result.hints).not.toContain('<number>');
    });

    test('/action obs.shutdown.cancel <space> → empty hints (no args)', () => {
      const result = getAutocomplete('/action obs.shutdown.cancel ');
      expect(result.hints).toEqual([]);
    });

    test('/action unknownaction <space> → empty hints (action not found)', () => {
      const result = getAutocomplete('/action unknownaction ');
      expect(result).toEqual({ completion: null, hints: [], completions: [] });
    });
  });

  // ── Enum value completion ─────────────────────────────────────────────────

  describe('enum value completion', () => {
    test('/action chat.send platform= → hints contain all enum values', () => {
      const result = getAutocomplete('/action chat.send platform=');
      expect(result.hints).toContain('twitch');
      expect(result.hints).toContain('youtube');
      expect(result.hints).toContain('kick');
    });

    test('/action chat.send platform=tw → single hint twitch, completes to full value', () => {
      const result = getAutocomplete('/action chat.send platform=tw');
      expect(result.hints).toEqual(['twitch']);
      expect(result.completion).toBe('/action chat.send platform=twitch');
    });

    test('/action chat.send platform=yt → completes to youtube via fuzzy subsequence match', () => {
      const result = getAutocomplete('/action chat.send platform=yt');
      expect(result.hints[0]).toBe('youtube');
      expect(result.completion).toBe('/action chat.send platform=youtube');
    });

    test('/action chat.send platform=xyz → empty hints (no enum match)', () => {
      const result = getAutocomplete('/action chat.send platform=xyz');
      expect(result).toEqual({ completion: null, hints: [], completions: [] });
    });
  });

  describe('dynamic provider value completion', () => {
    test('/action obs.source-recaller.save source= loads OBS source suggestions asynchronously', async () => {
      const initial = getAutocomplete('/action obs.source-recaller.save source=');
      expect(initial.hints).toContain('<loading…>');

      await Bun.sleep(0);

      const resolved = getAutocomplete('/action obs.source-recaller.save source=');
      expect(resolved.hints).toContain('Browser');
      expect(resolved.hints).toContain('Chat Box');
      expect(resolved.hints).toContain('[PS] PrimaryScreen.Browser');
    });

    test('/action obs.source-recaller.save source=[PS] PrimaryScreen.B filters dynamic suggestions with spaces in the active token', async () => {
      getAutocomplete('/action obs.source-recaller.save source=[PS] PrimaryScreen.B');
      await Bun.sleep(0);

      const resolved = getAutocomplete(
        '/action obs.source-recaller.save source=[PS] PrimaryScreen.B',
      );
      expect(resolved.hints).toContain('[PS] PrimaryScreen.Browser');
    });

    test('/action obs.shutdown.initiate scene=[SS] Common hideSources=Browser,Ov completes the CSV tail only', async () => {
      getAutocomplete('/action obs.shutdown.initiate scene=[SS] Common hideSources=Browser,Ov');
      await Bun.sleep(0);

      const resolved = getAutocomplete(
        '/action obs.shutdown.initiate scene=[SS] Common hideSources=Browser,Ov',
      );
      expect(resolved.hints).toContain('Overlay');
      expect(resolved.completions).toContain(
        '/action obs.shutdown.initiate scene=[SS] Common hideSources=Browser,Overlay',
      );
    });
  });

  // ── Non-enum type hints ───────────────────────────────────────────────────

  describe('non-enum type hints', () => {
    test('/action obs.shutdown.initiate delay= → hints is [<number>], completion is null', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate delay=');
      expect(result.hints).toEqual(['<number>']);
      expect(result.completion).toBeNull();
    });

    test('/action obs.shutdown.initiate scene= → provider-backed scene suggestions begin loading', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate scene=');
      expect(result.hints).toEqual(['<loading…>']);
      expect(result.completion).toBeNull();
    });
  });
});
