import { beforeAll, describe, expect, test } from 'bun:test';
import { IpcActionError, registry } from '../src/actions/registry';
import { IPC_ERROR_CODES } from '../src/actions/types';
import { handleRequest } from '../src/ipc/server';

const ctx = {} as Parameters<typeof handleRequest>[2];
const mockHandleCommand = async (cmd: string) => `output:${cmd}`;

const T_SAFE = 'proto-test:safe';
const T_BLOCKED = 'proto-test:blocked';
const T_CONFIRM = 'proto-test:confirm';
const T_VALIDATE = 'proto-test:validate';
const T_THROWS = 'proto-test:throws';
const T_IPC_ERROR = 'proto-test:ipc-error';
const T_TUI_MIRROR = 'proto-test:tui-mirror';

beforeAll(() => {
  const base = {
    title: '',
    description: '',
    domain: 'test',
    ipcEnabled: true,
    readOnly: true,
    visibility: 'public' as const,
    args: {},
  };

  registry.registerAction({
    ...base,
    id: T_SAFE,
    safety: 'safe',
    args: { msg: { type: 'string' as const, required: false, maxLength: 500 } },
    invoke: async (args) => ({ output: [`safe:${args.msg ?? ''}`], data: { received: args } }),
  });
  registry.registerAction({
    ...base,
    id: T_BLOCKED,
    safety: 'blocked',
    invoke: async () => ({ output: ['should not reach'] }),
  });
  registry.registerAction({
    ...base,
    id: T_CONFIRM,
    safety: 'confirm',
    invoke: async () => ({ output: ['should not reach'] }),
  });
  registry.registerAction({
    ...base,
    id: T_VALIDATE,
    safety: 'safe',
    args: { required_field: { type: 'string' as const, required: true, maxLength: 500 } },
    invoke: async (args) => ({ output: [`validated:${args.required_field}`] }),
  });
  registry.registerAction({
    ...base,
    id: T_THROWS,
    safety: 'safe',
    invoke: async () => {
      throw new Error('secret internal details');
    },
  });
  registry.registerAction({
    ...base,
    id: T_IPC_ERROR,
    safety: 'safe',
    invoke: async () => {
      throw new IpcActionError('custom_code', 'custom message');
    },
  });
  registry.registerAction({
    ...base,
    id: T_TUI_MIRROR,
    safety: 'safe',
    ipcOutputMode: 'response_and_tui',
    invoke: async () => ({
      output: ['mirrored:line'],
      warnings: ['mirrored warning'],
    }),
  });
});

// ---------------------------------------------------------------------------

describe('list_actions', () => {
  test('returns ok with action list and matching count', async () => {
    const res = await handleRequest({ type: 'list_actions' }, mockHandleCommand, ctx);
    expect(res.ok).toBe(true);
    const data = (res.result as { data: { actions: unknown[]; count: number } }).data;
    expect(data.count).toBe(data.actions.length);
    expect(data.count).toBeGreaterThan(0);
  });

  test('no entry has an invoke property', async () => {
    const res = await handleRequest({ type: 'list_actions' }, mockHandleCommand, ctx);
    const data = (res.result as { data: { actions: Record<string, unknown>[] } }).data;
    for (const action of data.actions) {
      expect(action).not.toHaveProperty('invoke');
    }
  });

  test('details:true includes args in output', async () => {
    const res = await handleRequest(
      { type: 'list_actions', details: true },
      mockHandleCommand,
      ctx,
    );
    const data = (res.result as { data: { actions: Record<string, unknown>[] } }).data;
    const safe = data.actions.find((a) => a.id === T_SAFE);
    expect(safe).toBeDefined();
    expect(safe?.args).toBeDefined();
    expect(safe).not.toHaveProperty('invoke');
  });

  test('details:false still returns count matching length', async () => {
    const res = await handleRequest(
      { type: 'list_actions', details: false },
      mockHandleCommand,
      ctx,
    );
    const data = (res.result as { data: { actions: unknown[]; count: number } }).data;
    expect(data.count).toBe(data.actions.length);
  });
});

describe('describe_action', () => {
  test('returns full metadata for known action', async () => {
    const res = await handleRequest(
      { type: 'describe_action', action: T_SAFE },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(true);
    const data = (res.result as { data: Record<string, unknown> }).data;
    expect(data.id).toBe(T_SAFE);
    expect(data.safety).toBe('safe');
  });

  test('invoke fn is NOT present in returned data', async () => {
    const res = await handleRequest(
      { type: 'describe_action', action: T_SAFE },
      mockHandleCommand,
      ctx,
    );
    const data = (res.result as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('invoke');
  });

  test('returns unknown_action for unregistered id', async () => {
    const res = await handleRequest(
      { type: 'describe_action', action: 'nonexistent:action' },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.UNKNOWN_ACTION);
  });

  test('returns invalid_args when action field is missing', async () => {
    const res = await handleRequest({ type: 'describe_action' }, mockHandleCommand, ctx);
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.INVALID_ARGS);
  });
});

describe('invoke_action', () => {
  test('successful invocation returns ok with action, output, data', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_SAFE, args: { msg: 'hello' } },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(true);
    const result = res.result as { action: string; output: string[]; data: unknown };
    expect(result.action).toBe(T_SAFE);
    expect(result.output).toEqual(['safe:hello']);
    expect(result.data).toBeDefined();
  });

  test('returns invalid_args when required arg is missing', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_VALIDATE, args: {} },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.INVALID_ARGS);
  });

  test('returns unknown_action for unregistered action id', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: 'nope:does-not-exist' },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.UNKNOWN_ACTION);
  });

  test('returns action_blocked for blocked action', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_BLOCKED },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.ACTION_BLOCKED);
  });

  test('returns requires_confirmation for confirm-safety action', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_CONFIRM },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.REQUIRES_CONFIRMATION);
  });

  test('internal error returns internal_error code without leaking message', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_THROWS },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string; message: string })?.code).toBe(
      IPC_ERROR_CODES.INTERNAL_ERROR,
    );
    expect((res.error as { message: string })?.message).toBe('Internal error');
    expect(JSON.stringify(res)).not.toContain('secret internal details');
  });

  test('IpcActionError propagates its code', async () => {
    const res = await handleRequest(
      { type: 'invoke_action', action: T_IPC_ERROR },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe('custom_code');
  });

  test('returns invalid_args when action field is missing', async () => {
    const res = await handleRequest({ type: 'invoke_action' }, mockHandleCommand, ctx);
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.INVALID_ARGS);
  });

  test('mirrors opt-in action output and warnings to the live TUI', async () => {
    const mirrored: string[] = [];
    const res = await handleRequest(
      { type: 'invoke_action', action: T_TUI_MIRROR },
      mockHandleCommand,
      ctx,
      (line) => mirrored.push(line),
    );

    expect(res.ok).toBe(true);
    expect(mirrored).toEqual(['mirrored:line', '[system] mirrored warning']);
  });
});

describe('command compat — type:command', () => {
  test('routes to handleCommandForCli and wraps output', async () => {
    const res = await handleRequest(
      { type: 'command', command: '/marker test' },
      mockHandleCommand,
      ctx,
    );
    expect(res.ok).toBe(true);
    const result = res.result as { action: string; output: string };
    expect(result.action).toBe('command');
    expect(result.output).toBe('output:/marker test');
  });
});

describe('legacy compat — no type field', () => {
  test('routes command field to handleCommandForCli when type is absent', async () => {
    const res = await handleRequest({ command: '/help' }, mockHandleCommand, ctx);
    expect(res.ok).toBe(true);
    const result = res.result as { action: string; output: string };
    expect(result.action).toBe('command');
    expect(result.output).toBe('output:/help');
  });
});

describe('unknown type', () => {
  test('returns unknown_request_type for unrecognised type', async () => {
    const res = await handleRequest({ type: 'totally_unknown' }, mockHandleCommand, ctx);
    expect(res.ok).toBe(false);
    expect((res.error as { code: string })?.code).toBe(IPC_ERROR_CODES.UNKNOWN_REQUEST_TYPE);
  });
});
