import { describe, expect, test } from 'bun:test';
import {
  formatScriptActionRow,
  getLocalScriptActionId,
  getVisibleScriptActions,
  type ScriptActionListItem,
} from '../src/ui/scriptActionsModal';

const spec = {
  scriptId: 'obs-scene-change',
  actionPrefix: 'obs.scene',
  title: 'OBS Scene Actions',
};

const action = (patch: Partial<ScriptActionListItem>): ScriptActionListItem => ({
  id: 'obs.scene.activate',
  title: 'Activate',
  description: 'Activate a scene',
  args: {},
  visibility: 'public',
  safety: 'safe',
  scriptId: 'obs-scene-change',
  ...patch,
});

describe('getVisibleScriptActions', () => {
  test('filters to public unblocked actions for the requested script', () => {
    const actions = [
      action({ id: 'obs.scene.zed' }),
      action({ id: 'obs.scene.actions' }),
      action({ id: 'obs.scene.hidden', visibility: 'private' }),
      action({ id: 'obs.scene.blocked', safety: 'blocked' }),
      action({ id: 'other.activate', scriptId: 'other-script' }),
      action({ id: 'obs.scene.alpha' }),
    ];

    expect(getVisibleScriptActions(actions, spec).map((entry) => entry.id)).toEqual([
      'obs.scene.alpha',
      'obs.scene.zed',
    ]);
  });
});

describe('script action row helpers', () => {
  test('formats local ids and argument markers', () => {
    expect(getLocalScriptActionId('obs.scene.activate', 'obs.scene')).toBe('activate');
    expect(getLocalScriptActionId('other.activate', 'obs.scene')).toBe('other.activate');

    expect(formatScriptActionRow(action({ id: 'obs.scene.activate' }), 'obs.scene', true)).toBe(
      '> activate',
    );
    expect(
      formatScriptActionRow(
        action({ id: 'obs.scene.activate', args: { scene: { type: 'string' } } }),
        'obs.scene',
        false,
      ),
    ).toBe('  activate  [args]');
  });
});
