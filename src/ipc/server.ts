import * as fs from 'node:fs';
import * as net from 'node:net';
import { IpcActionError, registry } from '../actions/registry';
import type { ActionContext } from '../actions/types';
import type { PlatformProvider } from '../platforms/base';
import type { ChatService } from '../services/chat.service';
import { resolveSocketPath } from './socket-path';

export function startIpcServer(
  handleCommandForCli: (cmd: string) => Promise<string>,
  chatService: ChatService,
  providers: Record<string, PlatformProvider>,
  mirrorToTui?: (line: string) => void,
): void {
  const socketPath = resolveSocketPath();

  try {
    fs.unlinkSync(socketPath);
  } catch {
    // no stale socket
  }

  const ctx: ActionContext = { chatService, providers };

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx);
      buffer = '';
      try {
        const req = JSON.parse(line) as Record<string, unknown>;
        const response = await handleRequest(req, handleCommandForCli, ctx, mirrorToTui);
        socket.write(`${JSON.stringify(response)}\n`);
      } catch {
        socket.write(
          `${JSON.stringify({ ok: false, error: { code: 'internal_error', message: 'Internal error' } })}\n`,
        );
      }
      socket.end();
    });
    socket.on('error', (err) => {
      console.error('[ipc] connection error', err);
    });
  });

  server.listen(socketPath, () => {
    fs.chmodSync(socketPath, 0o600);
  });
  server.on('error', (err) => {
    console.error('[ipc] server error', err);
  });

  const cleanup = () => {
    server.close();
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // already removed
    }
  };

  process.once('exit', cleanup);
}

export async function handleRequest(
  req: Record<string, unknown>,
  handleCommandForCli: (cmd: string) => Promise<string>,
  ctx: ActionContext,
  mirrorToTui?: (line: string) => void,
): Promise<Record<string, unknown>> {
  const type = req.type as string | undefined;

  if (type === 'list_actions') {
    const details = Boolean(req.details);
    const actions = registry.listActions({ ipcOnly: true, details });
    return {
      ok: true,
      result: {
        action: 'list_actions',
        data: { actions, count: actions.length },
      },
    };
  }

  if (type === 'describe_action') {
    const id = req.action as string | undefined;
    if (!id) {
      return {
        ok: false,
        error: { code: 'invalid_args', message: 'Missing required field: action' },
      };
    }
    const meta = registry.getAction(id);
    if (!meta) {
      return {
        ok: false,
        error: { code: 'unknown_action', message: `Unknown action: ${id}` },
      };
    }
    const { invoke: _invoke, ...rest } = meta;
    return { ok: true, result: { action: 'describe_action', data: rest } };
  }

  if (type === 'invoke_action') {
    const id = req.action as string | undefined;
    if (!id) {
      return {
        ok: false,
        error: { code: 'invalid_args', message: 'Missing required field: action' },
      };
    }
    const args = (req.args ?? {}) as Record<string, unknown>;
    try {
      const def = registry.getAction(id);
      const result = await registry.invokeAction(id, args, ctx);
      if (def?.ipcOutputMode === 'response_and_tui' && mirrorToTui) {
        for (const line of result.output ?? []) mirrorToTui(line);
        for (const warning of result.warnings ?? []) mirrorToTui(`[system] ${warning}`);
      }
      return {
        ok: true,
        result: {
          action: id,
          output: result.output,
          data: result.data,
          warnings: result.warnings,
        },
      };
    } catch (err) {
      if (err instanceof IpcActionError) {
        return {
          ok: false,
          error: { code: err.code, message: err.message, details: err.details },
        };
      }
      return {
        ok: false,
        error: { code: 'internal_error', message: 'Internal error' },
      };
    }
  }

  // Legacy compat: { type: 'command', command: string } or { command: string }
  const command = req.command as string | undefined;
  if (type === 'command' || (!type && command !== undefined)) {
    if (!command) {
      return {
        ok: false,
        error: { code: 'invalid_args', message: 'Missing required field: command' },
      };
    }
    const output = await handleCommandForCli(command);
    return { ok: true, output };
  }

  return {
    ok: false,
    error: { code: 'unknown_request_type', message: `Unknown request type: ${type ?? '(none)'}` },
  };
}
