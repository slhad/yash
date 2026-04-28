import * as fs from 'node:fs';
import * as path from 'node:path';

const isServer = typeof process !== 'undefined' && typeof process.env !== 'undefined';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  timestamp?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private timestamp: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '';
    this.timestamp = options.timestamp ?? true;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      this.log('ERROR', message, args);
    }
  }

  private log(level: string, message: string, args: unknown[]): void {
    // Redaction for sensitive information in logs.
    // Patterns are intentionally conservative; extend if you add new secret keys.
    const SENSITIVE_KEY_PATTERN =
      /(password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret|streamKey)/i;

    // JSON replacer to redact object properties whose key matches sensitive patterns.
    const redactReplacer = (k: string, v: any) => {
      try {
        if (k && SENSITIVE_KEY_PATTERN.test(k)) {
          return '***REDACTED***';
        }
      } catch (e) {
        // ignore
      }
      return v;
    };

    const parts: string[] = [];

    if (this.timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${level}]`);

    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }

    parts.push(message);

    if (args.length > 0) {
      parts.push(
        ...args.map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, redactReplacer);
            } catch (err) {
              return String(arg);
            }
          }
          return String(arg);
        }),
      );
    }

    let output = parts.join(' ');

    // Additional string-level redaction for simple key:value or key=value patterns
    // Match JSON-like keys ("password": "value") and plain key=value or key: value occurrences.
    const jsonKeyRegex =
      /("?(?:password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret|streamKey)"?\s*:\s*)(".*?"|'.*?'|[^,\s}]+)/gi;
    const keyValueRegex =
      /\b(?:password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key|client[_-]?secret|streamKey)\b\s*[=:]\s*([^,\s]+)/gi;

    try {
      output = output.replace(jsonKeyRegex, '$1"***REDACTED***"');
      output = output.replace(keyValueRegex, (match, p1) => {
        // preserve the key and replace the value
        return match.replace(p1, '***REDACTED***');
      });
    } catch (e) {
      // Fail-safe: if redaction fails, leave the output as-is
    }

    if (isServer) {
      process.stderr.write(output + '\n');
      fileLog(output);
    } else {
      console.error(output);
    }
  }
}

// ---------------------------------------------------------------------------
// File transport — appends to ~/.yash/yash.log, rotates at 10 MB
// ---------------------------------------------------------------------------
const LOG_DIR = isServer
  ? process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash')
  : '';
const LOG_FILE = isServer ? path.join(LOG_DIR, 'yash.log') : '';
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function fileLog(line: string): void {
  if (!isServer) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    // Rotate when the file exceeds the size limit
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
    } catch {
      // file doesn't exist yet — fine
    }
    // Always include a timestamp in the file even if the logger omits it
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${line}\n`);
  } catch {
    // never crash the app because of a logging failure
  }
}

// Default logger used by the app. Disable timestamp by default to reduce noisy
// output in TUI/console contexts; tests create their own Logger instances and
// control timestamp behavior explicitly.
export const defaultLogger = new Logger({ level: LogLevel.INFO, prefix: 'YASH', timestamp: false });

// Integrate with in-TUI log collector if available. This is a best-effort
// integration: require the module dynamically so server builds that don't
// include the TUI won't fail. The collector receives simple level/text
// messages and stores them for display inside the TUI.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const collector = require('./logCollector').default || require('./logCollector');
  // Wrap methods to append to collector as well as console
  const levels = ['debug', 'info', 'warn', 'error'];
  for (const l of levels) {
    const fn = (defaultLogger as any)[l];
    if (typeof fn === 'function') {
      (defaultLogger as any)[l] = function (msg: string, ...args: unknown[]) {
        try {
          collector.append(
            l.toUpperCase(),
            [msg, ...args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))].join(
              ' ',
            ),
          );
        } catch (_) {}
        return fn.call(this, msg, ...args);
      };
    }
  }
} catch (e) {
  // no-op if collector not present
}
