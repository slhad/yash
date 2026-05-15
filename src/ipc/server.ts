import * as fs from 'node:fs';
import * as net from 'node:net';
import { resolveSocketPath } from './socket-path';

export function startIpcServer(handleCommandForCli: (cmd: string) => Promise<string>): void {
  const socketPath = resolveSocketPath();

  try {
    fs.unlinkSync(socketPath);
  } catch {
    // no stale socket
  }

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx);
      buffer = '';
      try {
        const req = JSON.parse(line) as { command: string };
        const output = await handleCommandForCli(req.command);
        socket.write(`${JSON.stringify({ ok: true, output })}\n`);
      } catch (err) {
        socket.write(`${JSON.stringify({ ok: false, error: String(err) })}\n`);
      }
      socket.end();
    });
    socket.on('error', (err) => {
      console.error('[ipc] connection error', err);
    });
  });

  server.listen(socketPath);
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

  process.on('exit', cleanup);
}
