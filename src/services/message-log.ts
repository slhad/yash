import { Database } from 'bun:sqlite';
import path from 'node:path';
import type { ChatMessage } from '../platforms/base';
import { getDataDir } from '../utils/config';

export interface StreamSummary {
  streamId: string;
  platforms: string[];
  messageCount: number;
  userCount: number;
  startTime: number;
  endTime: number;
}

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
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user ON messages (platform, user_id, timestamp DESC)`,
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_stream ON messages (stream_id, timestamp DESC)`);
  }

  insert(msg: ChatMessage): void {
    // ignore if already exists (idempotent)
    this.db
      .prepare(`INSERT OR IGNORE INTO messages (id, platform, user_id, username, message, timestamp, color, badges, stream_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        msg.id,
        msg.platform,
        msg.userId,
        msg.username,
        msg.message,
        msg.timestamp,
        msg.color ?? null,
        msg.badges ? JSON.stringify(msg.badges) : null,
        msg.streamId ?? null,
      );
  }

  getForUser(platform: string, userId: string, limit = 100): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(platform, userId, limit) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  // Newest-first with offset — used for lazy loading in the chatter info modal.
  getForUserDesc(platform: string, userId: string, limit: number, offset: number): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .all(platform, userId, limit, offset) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  getForUserInStream(platform: string, userId: string, streamId: string): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE platform = ? AND user_id = ? AND stream_id = ?
         ORDER BY timestamp ASC`,
      )
      .all(platform, userId, streamId) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  getSessionStatsForUserInStream(
    platform: string,
    userId: string,
    streamId: string,
  ): { count: number; firstSeenAt?: Date } {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count, MIN(timestamp) as first_seen
         FROM messages
         WHERE platform = ? AND user_id = ? AND stream_id = ?`,
      )
      .get(platform, userId, streamId) as { count: number; first_seen: number | null } | null;
    return {
      count: result?.count ?? 0,
      firstSeenAt: result?.first_seen != null ? new Date(result.first_seen) : undefined,
    };
  }

  // All messages from stream sessions where this user participated — newest-first with offset.
  getContextForUserDesc(
    platform: string,
    userId: string,
    limit: number,
    offset: number,
  ): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
       WHERE stream_id IN (
         SELECT DISTINCT stream_id FROM messages
         WHERE platform = ? AND user_id = ? AND stream_id IS NOT NULL
       )
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .all(platform, userId, limit, offset) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  countContextForUser(platform: string, userId: string): number {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM messages
       WHERE stream_id IN (
         SELECT DISTINCT stream_id FROM messages
         WHERE platform = ? AND user_id = ? AND stream_id IS NOT NULL
       )`,
      )
      .get(platform, userId) as { count: number } | null;
    return result?.count ?? 0;
  }

  // Oldest-first with offset — general pagination utility.
  getForUserPaged(
    platform: string,
    userId: string,
    pageSize: number,
    offset: number,
  ): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE platform = ? AND user_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
      )
      .all(platform, userId, pageSize, offset) as Array<Record<string, unknown>>;
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
      badges: row.badges ? (JSON.parse(row.badges as string) as Record<string, string>) : undefined,
      streamId: (row.stream_id as string | null) ?? undefined,
    };
  }

  countForUser(platform: string, userId: string): number {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM messages WHERE platform = ? AND user_id = ?`)
      .get(platform, userId) as { count: number } | null;
    return result?.count ?? 0;
  }

  // All unique streams, most-recent first, with per-stream stats.
  getStreams(): StreamSummary[] {
    const rows = this.db
      .prepare(`
      SELECT
        stream_id,
        GROUP_CONCAT(DISTINCT platform) AS platforms,
        COUNT(*)                        AS message_count,
        COUNT(DISTINCT user_id)         AS user_count,
        MIN(timestamp)                  AS start_time,
        MAX(timestamp)                  AS end_time
      FROM messages
      WHERE stream_id IS NOT NULL
      GROUP BY stream_id
      ORDER BY MAX(timestamp) DESC
    `)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      streamId: r.stream_id as string,
      platforms: (r.platforms as string).split(','),
      messageCount: r.message_count as number,
      userCount: r.user_count as number,
      startTime: r.start_time as number,
      endTime: r.end_time as number,
    }));
  }

  // Messages for one stream, newest-first with offset (for lazy-load prepend).
  getForStream(streamId: string, limit: number, offset: number): ChatMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE stream_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .all(streamId, limit, offset) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  countForStream(streamId: string): number {
    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM messages WHERE stream_id = ?`)
      .get(streamId) as { count: number } | null;
    return result?.count ?? 0;
  }

  // Full-text search across message content, username, and stream_id.
  searchMessages(
    query: string,
    opts?: { username?: string; platform?: string; limit?: number },
  ): ChatMessage[] {
    const limit = opts?.limit ?? 200;
    const conditions: string[] = [];
    const params: string[] = [];

    if (query) {
      conditions.push(
        "(LOWER(message) LIKE ? OR LOWER(username) LIKE ? OR LOWER(COALESCE(stream_id, '')) LIKE ?)",
      );
      const q = `%${query.toLowerCase()}%`;
      params.push(q, q, q);
    }
    if (opts?.username) {
      conditions.push('LOWER(username) LIKE ?');
      params.push(`%${opts.username.toLowerCase()}%`);
    }
    if (opts?.platform) {
      conditions.push('platform = ?');
      params.push(opts.platform);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = this.db
      .prepare(`SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params, limit) as Array<Record<string, unknown>>;
    return rows.map(MessageLog._rowToMessage);
  }

  close(): void {
    this.db.close();
  }
}

export const messageLog = new MessageLog();
