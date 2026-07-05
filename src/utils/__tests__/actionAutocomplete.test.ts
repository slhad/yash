import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { ActionArgSchema } from '../../actions/types';
import {
  __getActionAutocompleteDebugState,
  clearActionAutocompleteCaches,
  getDynamicActionArgAutocomplete,
  invalidateActionAutocompleteForObsEvent,
  setActionAutocompleteRuntime,
} from '../actionAutocomplete';

const ACTIVITY_TYPES_SCHEMA: ActionArgSchema = {
  type: 'string',
  required: true,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'activity.types',
    params: { valueMode: 'csv', platformArg: 'platform' },
  },
};

const SOURCE_SCHEMA: ActionArgSchema = {
  type: 'string',
  required: true,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'obs.sceneSources',
    params: {
      includeQualifiedRefs: true,
      sceneArg: 'scene',
    },
  },
};

function buildOptions(
  overrides: Partial<Parameters<typeof getDynamicActionArgAutocomplete>[0]> = {},
) {
  return {
    actionId: 'obs.shutdown.initiate',
    argName: 'source',
    schema: SOURCE_SCHEMA,
    rawInput: '/action obs.shutdown.initiate source=',
    actionIdToken: 'obs.shutdown.initiate',
    tokens: ['source='],
    currentArgs: {} as Record<string, string>,
    valuePartial: '',
    ...overrides,
  };
}

describe('actionAutocomplete cache behavior', () => {
  beforeEach(() => {
    clearActionAutocompleteCaches();
  });

  afterEach(() => {
    clearActionAutocompleteCaches();
    setActionAutocompleteRuntime(null);
  });

  test('discarded in-flight responses do not repopulate the cache after clear', async () => {
    let resolveItems: ((items: Array<{ sourceName: string }>) => void) | undefined;
    setActionAutocompleteRuntime({
      getObsConnectionState: () => true,
      getObsCurrentScene: async () => 'Scene A',
      getObsSceneList: async () => ({ scenes: [{ sceneName: 'Scene A' }] }),
      getObsSceneItemList: () =>
        new Promise<Array<{ sourceName: string }>>((resolve) => {
          resolveItems = resolve;
        }),
    });

    const first = getDynamicActionArgAutocomplete(buildOptions());
    expect(first?.loading).toBe(true);
    clearActionAutocompleteCaches();

    if (resolveItems) {
      resolveItems([{ sourceName: 'Old Source' }]);
    }
    await Bun.sleep(0);

    expect(__getActionAutocompleteDebugState().cacheKeys).toHaveLength(0);
  });

  test('invalidating on OBS source-related events clears cached suggestions', async () => {
    setActionAutocompleteRuntime({
      getObsConnectionState: () => true,
      getObsCurrentScene: async () => 'Scene A',
      getObsSceneList: async () => ({ scenes: [{ sceneName: 'Scene A' }] }),
      getObsSceneItemList: async () => [{ sourceName: 'Browser' }],
    });

    expect(getDynamicActionArgAutocomplete(buildOptions())?.loading).toBe(true);
    await Bun.sleep(0);

    expect(__getActionAutocompleteDebugState().cacheKeys.length).toBeGreaterThan(0);
    expect(invalidateActionAutocompleteForObsEvent({ eventType: 'SceneItemCreated' })).toBe(true);
    expect(__getActionAutocompleteDebugState().cacheKeys).toHaveLength(0);
    expect(invalidateActionAutocompleteForObsEvent({ eventType: 'StreamStateChanged' })).toBe(
      false,
    );
  });

  test('activity type provider suggests platform-specific CSV values', async () => {
    const first = getDynamicActionArgAutocomplete(
      buildOptions({
        actionId: 'obs.alerts.add',
        actionIdToken: 'obs.alerts.add',
        argName: 'types',
        schema: ACTIVITY_TYPES_SCHEMA,
        rawInput: '/action obs.alerts.add platform=twitch types=follow,ra',
        tokens: ['platform=twitch', 'types=follow,ra'],
        currentArgs: { platform: 'twitch' },
        valuePartial: 'follow,ra',
      }),
    );
    expect(first?.loading).toBe(true);
    await Bun.sleep(0);

    const resolved = getDynamicActionArgAutocomplete(
      buildOptions({
        actionId: 'obs.alerts.add',
        actionIdToken: 'obs.alerts.add',
        argName: 'types',
        schema: ACTIVITY_TYPES_SCHEMA,
        rawInput: '/action obs.alerts.add platform=twitch types=follow,ra',
        tokens: ['platform=twitch', 'types=follow,ra'],
        currentArgs: { platform: 'twitch' },
        valuePartial: 'follow,ra',
      }),
    );

    expect(resolved?.loading).toBe(false);
    expect(resolved?.hints).toContain('raid');
    expect(resolved?.completions).toContain(
      '/action obs.alerts.add platform=twitch types=follow,raid',
    );
    expect(resolved?.hints).not.toContain('superchat');
  });

  test('cache stays bounded when many explicit scenes are queried', async () => {
    setActionAutocompleteRuntime({
      getObsConnectionState: () => true,
      getObsCurrentScene: async () => 'Scene 0',
      getObsSceneList: async () => ({ scenes: [{ sceneName: 'Scene 0' }] }),
      getObsSceneItemList: async (sceneName) => [{ sourceName: `Source ${sceneName}` }],
    });

    for (let index = 0; index < 130; index++) {
      expect(
        getDynamicActionArgAutocomplete(
          buildOptions({
            tokens: [`scene=Scene ${index}`, 'source='],
            currentArgs: { scene: `Scene ${index}` },
            rawInput: `/action obs.shutdown.initiate scene=Scene ${index} source=`,
          }),
        )?.loading,
      ).toBe(true);
      await Bun.sleep(0);
    }

    expect(__getActionAutocompleteDebugState().cacheKeys.length).toBeLessThanOrEqual(100);
  });
});
