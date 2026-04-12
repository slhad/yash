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

    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

// Default logger used by the app. Disable timestamp by default to reduce noisy
// output in TUI/console contexts; tests create their own Logger instances and
// control timestamp behavior explicitly.
export const defaultLogger = new Logger({ level: LogLevel.INFO, prefix: 'YASH', timestamp: false });
