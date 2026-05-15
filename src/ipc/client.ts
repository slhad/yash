import * as net from 'node:net';
import { resolveSocketPath } from './socket-path';

export async function sendCliCommand(command: string): Promise<void> {
  const socketPath = resolveSocketPath();

  return new Promise<void>((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify({ command })}\n`);
    });

    client.on('data', (data) => {
      try {
        const res = JSON.parse(data.toString()) as { ok: boolean; output?: string; error?: string };
        if (res.ok) {
          if (res.output) process.stdout.write(`${res.output}\n`);
        } else {
          process.stderr.write(`${res.error ?? 'Unknown error'}\n`);
          process.exitCode = 1;
        }
      } catch {
        process.stderr.write('Invalid response from yash\n');
        process.exitCode = 1;
      }
      client.end();
      resolve();
    });

    client.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        process.stderr.write('yash is not running\n');
        process.exit(1);
      }
      reject(err);
    });
  });
}
