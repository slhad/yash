type CommandHandlersRecord = Record<
  string,
  (parts: string[], emit: (line: string) => void) => Promise<void>
>;

const TUI_ONLY_COMMANDS = new Set(['/stream', '/setup-youtube', '/history', '/chatter']);

export async function runIpcCommand(
  trimmed: string,
  commandHandlers: CommandHandlersRecord,
  onEvent: (platform: string, type: string, message: string) => void,
  mirrorToTui?: (line: string) => void,
): Promise<string> {
  const parts = trimmed.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();

  if (cmd === '/exit') return 'Cannot exit the TUI via IPC';
  if (TUI_ONLY_COMMANDS.has(cmd)) return 'This command requires the TUI';
  if (cmd === '/memory' && (parts[1] ?? '').toLowerCase() === 'modal') {
    return 'This command requires the TUI';
  }
  if (cmd === '/settings' && !parts[1]) return 'This command requires the TUI';
  if (cmd === '/markers' && (parts[1] ?? '').toLowerCase() === 'edit') {
    return 'This command requires the TUI';
  }
  if (cmd === '/action' && (parts[1] ?? '').toLowerCase().endsWith('.configtui')) {
    return 'This command requires the TUI';
  }

  const lines: string[] = [];
  const emit = (line: string) => {
    lines.push(line);
    mirrorToTui?.(line);
  };

  const handler = commandHandlers[cmd];
  if (handler) {
    await handler(parts, emit);
    onEvent('ipc', 'command', trimmed);
  } else {
    emit(`[system] Unknown command: ${trimmed}`);
  }

  return lines.join('\n');
}
