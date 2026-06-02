import { describe, expect, test } from 'bun:test';
import { runIpcCommand } from '../src/utils/ipcCommandRunner';

const fakeHandlers = {
  '/help': async (_parts: string[], emit: (line: string) => void) => {
    emit('[help] this is help');
  },
  '/info': async (_parts: string[], emit: (line: string) => void) => {
    emit('[system] info output');
  },
};

describe('runIpcCommand — IPC event logging', () => {
  test('calls onEvent with ipc/command for a known command', async () => {
    const events: Array<[string, string, string]> = [];
    const onEvent = (p: string, t: string, m: string) => events.push([p, t, m]);

    await runIpcCommand('/help', fakeHandlers, onEvent);

    expect(events).toEqual([['ipc', 'command', '/help']]);
  });

  test('passes full trimmed string (with args) to onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const onEvent = (p: string, t: string, m: string) => events.push([p, t, m]);

    await runIpcCommand('/info extra args', fakeHandlers, onEvent);

    expect(events).toEqual([['ipc', 'command', '/info extra args']]);
  });

  test('does NOT call onEvent for an unknown command', async () => {
    const events: Array<[string, string, string]> = [];
    const onEvent = (p: string, t: string, m: string) => events.push([p, t, m]);

    await runIpcCommand('/unknown', fakeHandlers, onEvent);

    expect(events).toHaveLength(0);
  });

  test('returns error string for unknown command without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/unknown', fakeHandlers, () => events.push(['', '', '']));

    expect(result).toContain('Unknown command');
    expect(events).toHaveLength(0);
  });

  test('returns "Cannot exit" for /exit without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/exit', fakeHandlers, () => events.push(['', '', '']));

    expect(result).toBe('Cannot exit the TUI via IPC');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /stream without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/stream', fakeHandlers, () => events.push(['', '', '']));

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /settings with no subcommand without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/settings', fakeHandlers, () => events.push(['', '', '']));

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /memory modal without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/memory modal', fakeHandlers, () =>
      events.push(['', '', '']),
    );

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /markers edit without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/markers edit 2', fakeHandlers, () =>
      events.push(['', '', '']),
    );

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /action obs.shutdown.configTUI without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/action obs.shutdown.configTUI', fakeHandlers, () =>
      events.push(['', '', '']),
    );

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /action obs.source-recaller.configTUI without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/action obs.source-recaller.configTUI', fakeHandlers, () =>
      events.push(['', '', '']),
    );

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns TUI-only message for /action obs.startup.configTUI without calling onEvent', async () => {
    const events: Array<[string, string, string]> = [];
    const result = await runIpcCommand('/action obs.startup.configTUI', fakeHandlers, () =>
      events.push(['', '', '']),
    );

    expect(result).toBe('This command requires the TUI');
    expect(events).toHaveLength(0);
  });

  test('returns handler output as joined string', async () => {
    const result = await runIpcCommand('/help', fakeHandlers, () => {});

    expect(result).toBe('[help] this is help');
  });

  test('mirrors emitted output to the live TUI when requested', async () => {
    const mirrored: string[] = [];

    const result = await runIpcCommand(
      '/help',
      fakeHandlers,
      () => {},
      (line) => {
        mirrored.push(line);
      },
    );

    expect(result).toBe('[help] this is help');
    expect(mirrored).toEqual(['[help] this is help']);
  });
});
