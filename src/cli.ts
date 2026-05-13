import { sendCliCommand } from './ipc/client';

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Usage: bun run cmd <command> [args...]\n');
  process.exit(1);
}

const first = args[0]!;
const command = first.startsWith('/') ? args.join(' ') : `/${args.join(' ')}`;
await sendCliCommand(command);
