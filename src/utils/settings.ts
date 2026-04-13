import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { defaultLogger } from './logger';

const DEFAULT_FILENAME = 'settings.json';

export class SettingsStore {
  private data: Record<string, any> = {};
  private filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir || process.env.YASH_DATA_DIR || path.join(process.env.HOME || '.', '.yash');
    this.filePath = path.join(dir, DEFAULT_FILENAME);
    // ensure data dir exists and load existing settings
    void this.init();
  }

  private async init() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf8');
      try {
        this.data = JSON.parse(content);
      } catch {
        defaultLogger.warn('Corrupt settings file, starting fresh');
        this.data = {};
      }
    } catch (err) {
      // File may not exist; start with empty settings
      this.data = {};
    }
  }

  get(key: string, defaultValue: any = null) {
    return this.data[key] ?? defaultValue;
  }

  async set(key: string, value: any) {
    this.data[key] = value;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      defaultLogger.error('Failed to persist settings', err);
    }
  }
}

export default SettingsStore;
