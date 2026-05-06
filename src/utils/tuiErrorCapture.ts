import logCollector from './logCollector';

type StdioWrite = typeof process.stderr.write;

let installed = false;
let originalStderrWrite: StdioWrite | null = null;

function stringifyError(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendText(level: string, text: string): void {
  const trimmed = text.replace(/\r/g, '').trim();
  if (!trimmed) return;
  for (const line of trimmed.split('\n')) {
    const message = line.trim();
    if (!message) continue;
    logCollector.append(level, message);
  }
}

function stderrWriteToCollector(
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
): boolean {
  const text =
    typeof chunk === 'string'
      ? chunk
      : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8');
  appendText('STDERR', text);
  const cb = typeof encoding === 'function' ? encoding : callback;
  cb?.(null);
  return true;
}

function attachProcessListeners(): void {
  process.on('warning', (warning) => {
    appendText('WARN', stringifyError(warning));
  });

  process.on('unhandledRejection', (reason) => {
    appendText('ERROR', `Unhandled rejection: ${stringifyError(reason)}`);
  });

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    appendText('ERROR', `Uncaught exception (${origin}): ${stringifyError(error)}`);
  });
}

export function installTuiErrorCapture(): void {
  if (installed) return;
  installed = true;
  originalStderrWrite = process.stderr.write.bind(process.stderr) as StdioWrite;
  process.stderr.write = stderrWriteToCollector as StdioWrite;
  attachProcessListeners();
}

export function restoreTuiErrorCapture(): void {
  if (!installed) return;
  installed = false;
  if (originalStderrWrite) {
    process.stderr.write = originalStderrWrite;
    originalStderrWrite = null;
  }
}

export { appendText, stderrWriteToCollector, stringifyError };
