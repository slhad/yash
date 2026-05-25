import { beforeEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '../../actions/registry';
import type { YashActionDefinition } from '../../actions/types';
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
        scene: { type: 'string', maxLength: 200 },
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
      expect(result.hints).toEqual(['obs.shutdown.initiate']);
    });

    test('/action osi → completes to obs.shutdown.initiate via fuzzy subsequence match', () => {
      const result = getAutocomplete('/action osi');
      expect(result.completion).toBe('/action obs.shutdown.initiate');
      expect(result.hints[0]).toBe('obs.shutdown.initiate');
    });

    test('/action obs.shutdown. → hints contain both obs.shutdown.* actions', () => {
      const result = getAutocomplete('/action obs.shutdown.');
      expect(result.hints).toContain('obs.shutdown.initiate');
      expect(result.hints).toContain('obs.shutdown.cancel');
    });

    test('/action xyz → empty (no match)', () => {
      const result = getAutocomplete('/action xyz');
      expect(result).toEqual({ completion: null, hints: [], completions: [] });
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
      expect(result.hints).toEqual(['delay=']);
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

  // ── Non-enum type hints ───────────────────────────────────────────────────

  describe('non-enum type hints', () => {
    test('/action obs.shutdown.initiate delay= → hints is [<number>], completion is null', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate delay=');
      expect(result.hints).toEqual(['<number>']);
      expect(result.completion).toBeNull();
    });

    test('/action obs.shutdown.initiate scene= → hints is [<string>], completion is null', () => {
      const result = getAutocomplete('/action obs.shutdown.initiate scene=');
      expect(result.hints).toEqual(['<string>']);
      expect(result.completion).toBeNull();
    });
  });
});
