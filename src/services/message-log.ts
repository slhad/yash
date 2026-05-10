import { Database } from 'bun:sqlite';
import { getDataDir } from '../utils/config';
import type { ChatMessage } from '../platforms/base';
import path from 'path';

export class MessageLog {
  private db: Database;

  constructor(dbPath: string = path.join(getDataDir(), 'messages.db')) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      color TEXT,
      badges TEXT,
      stream_id TEXT
    )`);
    // Migrate existing DBs that predate stream_id
    try {
      this.db.exec('ALTER TABLE messages ADD COLUMN stream_id TEXT');
    } catch {
      // Column already exists — ignore
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user ON messages (platform, user_id, timestamp DESC)`);
  }

  insert(msg: ChatMessage): void {
    // ignore if already exists (idempotent)
    this.db.prepare(`INSERT OR IGNORE INTO messages (id, platform, user_id, username, message, timestamp, color, badges, stream_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      msg.id, msg.platform, msg.userId, msg.username, msg.message,
      msg.timestamp, msg.color ?? null, msg.badges ? JSON.stringify(msg.badges) : null,
      msg.streamId ?? null
    );
  }

  getForUser(platform: string, userId: string, limit = 100): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(platform, userId, limit) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  // Newest-first with offset — used for lazy loading in the chatter info modal.
  getForUserDesc(platform: string, userId: string, limit: number, offset: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(platform, userId, limit, offset) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  // Oldest-first with offset — general pagination utility.
  getForUserPaged(platform: string, userId: string, pageSize: number, offset: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`
    ).all(platform, userId, pageSize, offset) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  private static _rowToMessage(row: Record<string, unknown>): ChatMessage {
    return {
      id: row.id as string,
      platform: row.platform as string,
      userId: row.user_id as string,
      username: row.username as string,
      message: row.message as string,
      timestamp: row.timestamp as number,
      color: row.color as string | undefined,
      badges: row.badges ? JSON.parse(row.badges as string) as Record<string, string> : undefined,
      streamId: (row.stream_id as string | null) ?? undefined,
    };
  }

  countForUser(platform: string, userId: string): number {
    const result = this.db.prepare(
      `SELECT COUNT(*) as count FROM messages WHERE platform = ? AND user_id = ?`
    ).get(platform, userId) as { count: number } | null;
    return result?.count ?? 0;
  }

  close(): void {
    this.db.close();
  }
}

export const messageLog = new MessageLog();
