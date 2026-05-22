import { describe, expect, test } from 'bun:test';
import { ActionRegistry, IpcActionError, registry } from '../../src/actions/registry';
import { IPC_ERROR_CODES, type ActionContext, type YashActionDefinition } from '../../src/actions/types';

// Side-effect imports: auto-register actions on the singleton for tests 6–7
import '../../src/actions/markers';
import '../../src/actions/chat';

const noopInvoke = async () => ({ output: ['ok'] });

function baseDef(overrides: Partial<YashActionDefinition> & { id: string }): YashActionDefinition {
  return {
    title: 'Test Action',
    description: 'desc',
    domain: 'test',
    ipcEnabled: true,
    readOnly: true,
    safety: 'safe',
    visibility: 'public',
    args: {},
    invoke: noopInvoke,
    ...overrides,
  };
}

const minimalCtx: ActionContext = {
  chatService: {} as ActionContext['chatService'],
  providers: {},
};

// ---------------------------------------------------------------------------
// 1. registerAction
// ---------------------------------------------------------------------------

describe('registerAction', () => {
  test('registers an action successfully', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'test.register' });
    reg.registerAction(def);
    expect(reg.getAction('test.register')).toBe(def);
  });

  test('throws on duplicate id', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'test.dup' });
    reg.registerAction(def);
    expect(() => reg.registerAction(baseDef({ id: 'test.dup' }))).toThrow('test.dup');
  });
});

// ---------------------------------------------------------------------------
// 2. getAction
// ---------------------------------------------------------------------------

describe('getAction', () => {
  test('returns the definition for a known id', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'test.known' });
    reg.registerAction(def);
    expect(reg.getAction('test.known')).toBe(def);
  });

  test('returns undefined for unknown id', () => {
    const reg = new ActionRegistry();
    expect(reg.getAction('test.no-such-action')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. listActions
// ---------------------------------------------------------------------------

describe('listActions', () => {
  const CONDENSED_KEYS = ['id', 'title', 'domain', 'readOnly', 'safety', 'args'];
  const FULL_KEYS = [
    'id', 'title', 'description', 'domain', 'ipcEnabled', 'readOnly', 'safety', 'visibility', 'args',
  ];

  test('returns condensed fields when details is absent', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.a' }));
    const [entry] = reg.listActions();
    expect(Object.keys(entry!).sort()).toEqual(CONDENSED_KEYS.sort());
  });

  test('returns condensed fields when details is false', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.b' }));
    const [entry] = reg.listActions({ details: false });
    expect(Object.keys(entry!).sort()).toEqual(CONDENSED_KEYS.sort());
  });

  test('returns full metadata (minus invoke) when details is true', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.c' }));
    const [entry] = reg.listActions({ details: true });
    for (const key of FULL_KEYS) {
      expect(entry).toHaveProperty(key);
    }
  });

  test('filters to ipcEnabled only when ipcOnly is true', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.ipc-yes', ipcEnabled: true }));
    reg.registerAction(baseDef({ id: 'list.ipc-no', ipcEnabled: false }));
    const entries = reg.listActions({ ipcOnly: true });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain('list.ipc-yes');
    expect(ids).not.toContain('list.ipc-no');
  });

  test('invoke fn is never present in condensed output', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.d' }));
    const [entry] = reg.listActions();
    expect(entry).not.toHaveProperty('invoke');
  });

  test('invoke fn is never present in details output', () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'list.e' }));
    const [entry] = reg.listActions({ details: true });
    expect(entry).not.toHaveProperty('invoke');
  });
});

// ---------------------------------------------------------------------------
// 4. validateArgs
// ---------------------------------------------------------------------------

describe('validateArgs', () => {
  test('passes when all required args provided with valid values', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.ok', args: { name: { type: 'string', required: true, maxLength: 50 } } });
    expect(reg.validateArgs(def, { name: 'hello' })).toEqual({ valid: true, errors: [] });
  });

  test('fails with errors when required arg is missing', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.missing', args: { name: { type: 'string', required: true, maxLength: 50 } } });
    const result = reg.validateArgs(def, {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('name');
  });

  test('fails when string exceeds maxLength', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.maxlen', args: { msg: { type: 'string', required: false, maxLength: 5 } } });
    expect(reg.validateArgs(def, { msg: 'toolong' }).valid).toBe(false);
  });

  test('fails when string is below minLength', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.minlen', args: { msg: { type: 'string', required: false, minLength: 5, maxLength: 100 } } });
    expect(reg.validateArgs(def, { msg: 'hi' }).valid).toBe(false);
  });

  test('fails when number is below min', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.nummin', args: { count: { type: 'number', required: false, min: 1, max: 10 } } });
    expect(reg.validateArgs(def, { count: 0 }).valid).toBe(false);
  });

  test('fails when number is above max', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.nummax', args: { count: { type: 'number', required: false, min: 1, max: 10 } } });
    expect(reg.validateArgs(def, { count: 99 }).valid).toBe(false);
  });

  test('fails when enum value is not in allowed list', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.enum', args: { color: { type: 'enum', required: false, values: ['red', 'green', 'blue'] } } });
    expect(reg.validateArgs(def, { color: 'purple' }).valid).toBe(false);
  });

  test('passes when optional arg is absent', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.optional', args: { tag: { type: 'string', required: false, maxLength: 20 } } });
    expect(reg.validateArgs(def, {})).toEqual({ valid: true, errors: [] });
  });

  test('fails with type error when wrong JS type provided for string arg', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.type-string', args: { label: { type: 'string', required: false, maxLength: 50 } } });
    expect(reg.validateArgs(def, { label: 42 }).valid).toBe(false);
  });

  test('fails with type error when wrong JS type provided for boolean arg', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.type-bool', args: { active: { type: 'boolean', required: false } } });
    expect(reg.validateArgs(def, { active: 'yes' }).valid).toBe(false);
  });

  test('fails with type error when wrong JS type provided for number arg', () => {
    const reg = new ActionRegistry();
    const def = baseDef({ id: 'validate.type-num', args: { count: { type: 'number', required: false, min: 0, max: 100 } } });
    expect(reg.validateArgs(def, { count: '5' }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. invokeAction
// ---------------------------------------------------------------------------

describe('invokeAction', () => {
  test('calls def.invoke with validated args and ctx on success', async () => {
    const reg = new ActionRegistry();
    let capturedArgs: Record<string, unknown> | undefined;
    let capturedCtx: ActionContext | undefined;
    reg.registerAction(baseDef({
      id: 'invoke.success',
      invoke: async (a, c) => { capturedArgs = a; capturedCtx = c; return { output: ['done'] }; },
    }));
    const result = await reg.invokeAction('invoke.success', { extra: 1 }, minimalCtx);
    expect(result.output).toEqual(['done']);
    expect(capturedArgs).toEqual({ extra: 1 });
    expect(capturedCtx).toBe(minimalCtx);
  });

  test('throws IpcActionError with unknown_action for unknown id', async () => {
    const reg = new ActionRegistry();
    await expect(reg.invokeAction('invoke.no-such', {}, minimalCtx)).rejects.toMatchObject({
      code: IPC_ERROR_CODES.UNKNOWN_ACTION,
    });
  });

  test('throws IpcActionError with action_unavailable when ipcEnabled is false', async () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'invoke.no-ipc', ipcEnabled: false }));
    await expect(reg.invokeAction('invoke.no-ipc', {}, minimalCtx)).rejects.toMatchObject({
      code: IPC_ERROR_CODES.ACTION_UNAVAILABLE,
    });
  });

  test('throws IpcActionError with action_blocked when safety is blocked', async () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'invoke.blocked', safety: 'blocked' }));
    await expect(reg.invokeAction('invoke.blocked', {}, minimalCtx)).rejects.toMatchObject({
      code: IPC_ERROR_CODES.ACTION_BLOCKED,
    });
  });

  test('throws IpcActionError with requires_confirmation when safety is confirm', async () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'invoke.confirm', safety: 'confirm' }));
    await expect(reg.invokeAction('invoke.confirm', {}, minimalCtx)).rejects.toMatchObject({
      code: IPC_ERROR_CODES.REQUIRES_CONFIRMATION,
    });
  });

  test('throws IpcActionError with invalid_args when arg validation fails', async () => {
    const reg = new ActionRegistry();
    reg.registerAction(baseDef({ id: 'invoke.bad-args', args: { name: { type: 'string', required: true, maxLength: 50 } } }));
    const err = await reg.invokeAction('invoke.bad-args', {}, minimalCtx).catch((e) => e);
    expect(err).toBeInstanceOf(IpcActionError);
    expect(err.code).toBe(IPC_ERROR_CODES.INVALID_ARGS);
    expect(err.details?.errors).toBeArray();
  });
});

// ---------------------------------------------------------------------------
// 6. markerCreateAction and markersListAction — singleton registration
// ---------------------------------------------------------------------------

describe('markerCreateAction and markersListAction', () => {
  test('markerCreateAction is registered in the singleton registry', () => {
    expect(registry.getAction('marker.create')).toBeDefined();
  });

  test('markerCreateAction has correct metadata', () => {
    const def = registry.getAction('marker.create')!;
    expect(def.domain).toBe('marker');
    expect(def.ipcEnabled).toBe(true);
    expect(def.readOnly).toBe(false);
    expect(def.safety).toBe('safe');
  });

  test('markersListAction is registered in the singleton registry', () => {
    expect(registry.getAction('markers.list')).toBeDefined();
  });

  test('markersListAction has correct metadata', () => {
    const def = registry.getAction('markers.list')!;
    expect(def.domain).toBe('markers');
    expect(def.ipcEnabled).toBe(true);
    expect(def.readOnly).toBe(true);
    expect(def.safety).toBe('safe');
  });

  test('invoke is not exposed via listActions on the singleton', () => {
    for (const entry of registry.listActions({ details: true })) {
      expect(entry).not.toHaveProperty('invoke');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. chatSendAction — singleton registration
// ---------------------------------------------------------------------------

describe('chatSendAction', () => {
  test('chatSendAction is registered in the singleton registry', () => {
    expect(registry.getAction('chat.send')).toBeDefined();
  });

  test('chatSendAction has correct metadata', () => {
    const def = registry.getAction('chat.send')!;
    expect(def.domain).toBe('chat');
    expect(def.ipcEnabled).toBe(true);
    expect(def.readOnly).toBe(false);
    expect(def.safety).toBe('safe');
  });
});
