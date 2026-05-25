import { describe, expect, test } from 'bun:test';
import type { ActionArgSchema, YashActionDefinition } from '../../actions/types';
import { formatActionHelp, parseActionArgs } from '../actionArgs';

// ---------------------------------------------------------------------------
// parseActionArgs
// ---------------------------------------------------------------------------

describe('parseActionArgs', () => {
  // ---- string ----

  test('single key=value string arg', () => {
    const schema: Record<string, ActionArgSchema> = {
      scene: { type: 'string', maxLength: 100 },
    };
    const { args, errors } = parseActionArgs(['scene=Lobby'], schema);
    expect(args).toEqual({ scene: 'Lobby' });
    expect(errors).toEqual([]);
  });

  test('single-quoted string arg is unwrapped', () => {
    const schema: Record<string, ActionArgSchema> = {
      source: { type: 'string', maxLength: 200 },
    };
    const { args, errors } = parseActionArgs(["source='[SC] Brio NB'"], schema);
    expect(args).toEqual({ source: '[SC] Brio NB' });
    expect(errors).toEqual([]);
  });

  test('double-quoted string arg is unwrapped', () => {
    const schema: Record<string, ActionArgSchema> = {
      source: { type: 'string', maxLength: 200 },
    };
    const { args, errors } = parseActionArgs(['source="[SC] Brio NB"'], schema);
    expect(args).toEqual({ source: '[SC] Brio NB' });
    expect(errors).toEqual([]);
  });

  // ---- number ----

  test('single key=value number arg coerced to number', () => {
    const schema: Record<string, ActionArgSchema> = {
      delay: { type: 'number' },
    };
    const { args, errors } = parseActionArgs(['delay=30'], schema);
    expect(args).toEqual({ delay: 30 });
    expect(errors).toEqual([]);
  });

  test('number arg NaN produces an error', () => {
    const schema: Record<string, ActionArgSchema> = {
      delay: { type: 'number' },
    };
    const { args, errors } = parseActionArgs(['delay=abc'], schema);
    expect(args).not.toHaveProperty('delay');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"delay"');
    expect(errors[0]).toContain('number');
  });

  // ---- boolean ----

  test.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
  ])('boolean variant %s → %s', (raw, expected) => {
    const schema: Record<string, ActionArgSchema> = {
      enabled: { type: 'boolean' },
    };
    const { args, errors } = parseActionArgs([`enabled=${raw}`], schema);
    expect(args).toEqual({ enabled: expected });
    expect(errors).toEqual([]);
  });

  test('boolean is case-insensitive (TRUE → true)', () => {
    const schema: Record<string, ActionArgSchema> = {
      enabled: { type: 'boolean' },
    };
    const { args, errors } = parseActionArgs(['enabled=TRUE'], schema);
    expect(args).toEqual({ enabled: true });
    expect(errors).toEqual([]);
  });

  test('boolean invalid value produces an error', () => {
    const schema: Record<string, ActionArgSchema> = {
      enabled: { type: 'boolean' },
    };
    const { args, errors } = parseActionArgs(['enabled=maybe'], schema);
    expect(args).not.toHaveProperty('enabled');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"enabled"');
    expect(errors[0]).toContain('boolean');
  });

  // ---- enum ----

  test('enum valid value is accepted', () => {
    const schema: Record<string, ActionArgSchema> = {
      mode: { type: 'enum', values: ['live', 'vod', 'clip'] },
    };
    const { args, errors } = parseActionArgs(['mode=vod'], schema);
    expect(args).toEqual({ mode: 'vod' });
    expect(errors).toEqual([]);
  });

  test('enum invalid value produces an error', () => {
    const schema: Record<string, ActionArgSchema> = {
      mode: { type: 'enum', values: ['live', 'vod', 'clip'] },
    };
    const { args, errors } = parseActionArgs(['mode=stream'], schema);
    expect(args).not.toHaveProperty('mode');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"mode"');
    expect(errors[0]).toContain('live');
  });

  // ---- unknown key ----

  test('unknown key goes to errors', () => {
    const schema: Record<string, ActionArgSchema> = {
      delay: { type: 'number' },
    };
    const { args, errors } = parseActionArgs(['foo=bar'], schema);
    expect(args).not.toHaveProperty('foo');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('foo');
  });

  // ---- space-in-value ----

  test('tokens without = are appended to current key value', () => {
    const schema: Record<string, ActionArgSchema> = {
      scene: { type: 'string', maxLength: 100 },
    };
    const { args, errors } = parseActionArgs(['scene=[PS]', 'End'], schema);
    expect(args).toEqual({ scene: '[PS] End' });
    expect(errors).toEqual([]);
  });

  // ---- multiple args ----

  test('multiple args parsed in a single token array', () => {
    const schema: Record<string, ActionArgSchema> = {
      delay: { type: 'number' },
      scene: { type: 'string', maxLength: 100 },
    };
    const { args, errors } = parseActionArgs(['delay=30', 'scene=Ending'], schema);
    expect(args).toEqual({ delay: 30, scene: 'Ending' });
    expect(errors).toEqual([]);
  });

  // ---- token without = at start ----

  test('token without = before any key is silently ignored', () => {
    const schema: Record<string, ActionArgSchema> = {
      scene: { type: 'string', maxLength: 100 },
    };
    const { args, errors } = parseActionArgs(['orphan', 'scene=Lobby'], schema);
    expect(args).toEqual({ scene: 'Lobby' });
    expect(errors).toEqual([]);
  });

  // ---- empty tokens ----

  test('empty tokens array returns empty args and errors', () => {
    const schema: Record<string, ActionArgSchema> = {
      scene: { type: 'string', maxLength: 100 },
    };
    const { args, errors } = parseActionArgs([], schema);
    expect(args).toEqual({});
    expect(errors).toEqual([]);
  });

  // ---- multiple errors collected ----

  test('multiple errors are all collected (unknown + bad number)', () => {
    const schema: Record<string, ActionArgSchema> = {
      delay: { type: 'number' },
    };
    const { args, errors } = parseActionArgs(['delay=notanumber', 'ghost=oops'], schema);
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('"delay"'))).toBe(true);
    expect(errors.some((e) => e.includes('ghost'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatActionHelp
// ---------------------------------------------------------------------------

type HelpDef = Pick<YashActionDefinition, 'id' | 'title' | 'description' | 'args' | 'examples'>;

describe('formatActionHelp', () => {
  const baseArgs: Record<string, ActionArgSchema> = {
    delay: { type: 'number', min: 1, max: 60, required: true },
    scene: { type: 'string', maxLength: 50 },
    mode: { type: 'enum', values: ['live', 'vod'] },
  };

  const minimalDef: HelpDef = {
    id: 'obs.shutdown',
    title: 'Shutdown OBS',
    description: 'Shuts down OBS with a countdown.',
    args: {},
  };

  test('header line contains id — title', () => {
    const lines = formatActionHelp(minimalDef);
    expect(lines[0]).toBe('obs.shutdown — Shutdown OBS');
  });

  test('description is the second line', () => {
    const lines = formatActionHelp(minimalDef);
    expect(lines[1]).toBe('Shuts down OBS with a countdown.');
  });

  test('Args: section is absent when args is empty', () => {
    const lines = formatActionHelp(minimalDef);
    expect(lines.join('\n')).not.toContain('Args:');
  });

  test('Args: section is present when args exist', () => {
    const def: HelpDef = { ...minimalDef, args: { delay: { type: 'number', required: true } } };
    const lines = formatActionHelp(def);
    expect(lines).toContain('Args:');
  });

  test('number arg with min+max shows min:X max:Y constraints', () => {
    const def: HelpDef = {
      ...minimalDef,
      args: { delay: { type: 'number', min: 1, max: 60, required: true } },
    };
    const lines = formatActionHelp(def);
    const argLine = lines.find((l) => l.includes('delay'));
    expect(argLine).toBeDefined();
    expect(argLine).toContain('min:1');
    expect(argLine).toContain('max:60');
  });

  test('string arg shows max:N constraint', () => {
    const def: HelpDef = {
      ...minimalDef,
      args: { scene: { type: 'string', maxLength: 50 } },
    };
    const lines = formatActionHelp(def);
    const argLine = lines.find((l) => l.includes('scene'));
    expect(argLine).toBeDefined();
    expect(argLine).toContain('max:50');
  });

  test('enum arg shows values: a|b constraint', () => {
    const def: HelpDef = {
      ...minimalDef,
      args: { mode: { type: 'enum', values: ['live', 'vod'] } },
    };
    const lines = formatActionHelp(def);
    const argLine = lines.find((l) => l.includes('mode'));
    expect(argLine).toBeDefined();
    expect(argLine).toContain('values: live|vod');
  });

  test('required arg shows "required", optional arg shows "optional"', () => {
    const def: HelpDef = {
      ...minimalDef,
      args: {
        delay: { type: 'number', required: true },
        scene: { type: 'string', maxLength: 50 },
      },
    };
    const lines = formatActionHelp(def);
    const delayLine = lines.find((l) => l.includes('delay'));
    const sceneLine = lines.find((l) => l.includes('scene'));
    expect(delayLine).toContain('required');
    expect(sceneLine).toContain('optional');
  });

  test('Examples: section present with (no args) label for empty-args example', () => {
    const def: HelpDef = {
      ...minimalDef,
      examples: [{ args: {}, description: 'basic usage' }],
    };
    const lines = formatActionHelp(def);
    expect(lines).toContain('Examples:');
    const exampleLine = lines.find((l) => l.includes('(no args)'));
    expect(exampleLine).toBeDefined();
    expect(exampleLine).toContain('basic usage');
  });

  test('Examples: section absent when no examples defined', () => {
    const lines = formatActionHelp(minimalDef);
    expect(lines.join('\n')).not.toContain('Examples:');
  });

  test('Examples: section absent when examples is empty array', () => {
    const def: HelpDef = { ...minimalDef, examples: [] };
    const lines = formatActionHelp(def);
    expect(lines.join('\n')).not.toContain('Examples:');
  });

  test('full action with multiple args + examples produces correct line count', () => {
    const def: HelpDef = {
      id: 'obs.shutdown',
      title: 'Shutdown OBS',
      description: 'Shuts down OBS with a countdown.',
      args: baseArgs,
      examples: [
        { args: { delay: 10, scene: 'Ending' }, description: 'quick shutdown' },
        { args: {}, description: 'default shutdown' },
      ],
    };
    const lines = formatActionHelp(def);

    // id — title, description, Args:, 3 arg lines, Examples:, 2 example lines = 9
    expect(lines).toHaveLength(9);

    // Spot-check ordering
    expect(lines[0]).toContain('obs.shutdown');
    expect(lines[2]).toBe('Args:');
    expect(lines[6]).toBe('Examples:');
  });
});
