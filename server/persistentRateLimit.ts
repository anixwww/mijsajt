import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from 'express-rate-limit';
import { getSqliteDb } from './sqliteStore.ts';

const MAX_BUCKETS = 10_000;

export function configurePersistentRateLimitPath(_filePath: string): void {
  // No-op for SQLite
}

export function flushRateLimitStoreSync(): void {
  // No-op for SQLite (WAL transactions are immediate)
}

export function checkPersistentRateLimit(
  bucketKey: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const db = getSqliteDb();
  const now = Date.now();

  db.exec('BEGIN IMMEDIATE');
  try {
    const selectStmt = db.prepare('SELECT count, reset_at_ms, timestamps_json FROM rate_limits WHERE bucket_key = ?');
    const row = selectStmt.get(bucketKey) as { count: number; reset_at_ms: number; timestamps_json: string } | undefined;

    let timestamps: number[] = [];
    if (row && row.timestamps_json) {
      try {
        const parsed = JSON.parse(row.timestamps_json);
        if (Array.isArray(parsed)) {
          timestamps = parsed.filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts) && ts > now - windowMs);
        }
      } catch {
        timestamps = [];
      }
    }

    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      db.exec('COMMIT');
      return { allowed: false, retryAfterSec };
    }

    timestamps.push(now);
    const upsertStmt = db.prepare(`
      INSERT OR REPLACE INTO rate_limits (bucket_key, count, reset_at_ms, timestamps_json, updated_at_ms)
      VALUES (?, ?, ?, ?, ?)
    `);
    upsertStmt.run(bucketKey, timestamps.length, now + windowMs, JSON.stringify(timestamps), now);
    db.exec('COMMIT');
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    db.exec('ROLLBACK');
    return { allowed: true, retryAfterSec: 0 };
  }
}

export class PersistentRateLimitStore implements Store {
  public readonly prefix: string;
  public readonly localKeys = false;
  private windowMs = 60_000;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = Math.max(1000, Number(options.windowMs) || 60_000);
  }

  private fullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  get(key: string): ClientRateLimitInfo | undefined {
    const db = getSqliteDb();
    const now = Date.now();
    const fk = this.fullKey(key);
    const stmt = db.prepare('SELECT count, reset_at_ms FROM rate_limits WHERE bucket_key = ?');
    const row = stmt.get(fk) as { count: number; reset_at_ms: number } | undefined;

    if (!row || row.reset_at_ms <= now) {
      if (row) {
        const del = db.prepare('DELETE FROM rate_limits WHERE bucket_key = ?');
        del.run(fk);
      }
      return undefined;
    }
    return {
      totalHits: row.count,
      resetTime: new Date(row.reset_at_ms),
    };
  }

  increment(key: string): IncrementResponse {
    const db = getSqliteDb();
    const now = Date.now();
    const fk = this.fullKey(key);

    db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = db.prepare('SELECT count, reset_at_ms, timestamps_json FROM rate_limits WHERE bucket_key = ?');
      const row = stmt.get(fk) as { count: number; reset_at_ms: number; timestamps_json: string } | undefined;

      let count = 1;
      let resetAtMs = now + this.windowMs;

      if (row && row.reset_at_ms > now) {
        count = row.count + 1;
        resetAtMs = row.reset_at_ms;
      }

      const upsertStmt = db.prepare(`
        INSERT OR REPLACE INTO rate_limits (bucket_key, count, reset_at_ms, timestamps_json, updated_at_ms)
        VALUES (?, ?, ?, ?, ?)
      `);
      upsertStmt.run(fk, count, resetAtMs, row?.timestamps_json || '[]', now);
      db.exec('COMMIT');

      return {
        totalHits: count,
        resetTime: new Date(resetAtMs),
      };
    } catch {
      db.exec('ROLLBACK');
      return {
        totalHits: 1,
        resetTime: new Date(now + this.windowMs),
      };
    }
  }

  decrement(key: string): void {
    const db = getSqliteDb();
    const fk = this.fullKey(key);
    const stmt = db.prepare('SELECT count FROM rate_limits WHERE bucket_key = ?');
    const row = stmt.get(fk) as { count: number } | undefined;
    if (!row) return;
    const nextCount = Math.max(0, row.count - 1);
    const updateStmt = db.prepare('UPDATE rate_limits SET count = ?, updated_at_ms = ? WHERE bucket_key = ?');
    updateStmt.run(nextCount, Date.now(), fk);
  }

  resetKey(key: string): void {
    const db = getSqliteDb();
    const fk = this.fullKey(key);
    const del = db.prepare('DELETE FROM rate_limits WHERE bucket_key = ?');
    del.run(fk);
  }

  resetAll(): void {
    const db = getSqliteDb();
    const prefixWithColon = `${this.prefix}:`;
    const del = db.prepare('DELETE FROM rate_limits WHERE bucket_key LIKE ?');
    del.run(`${prefixWithColon}%`);
  }

  shutdown(): void {
    // No-op for SQLite
  }
}

export function createPersistentRateLimitStore(prefix: string): Store {
  return new PersistentRateLimitStore(prefix);
}
