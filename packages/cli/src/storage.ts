/**
 * SQLite storage for LimitRate events
 *
 * ⚠️  SECURITY: SQL INJECTION PREVENTION
 *
 * This file uses SQLite through better-sqlite3. To prevent SQL injection:
 *
 * 1. ALWAYS use parameterized queries with `?` placeholders
 * 2. NEVER concatenate user input into SQL strings
 * 3. NEVER use template literals for SQL queries with variables
 *
 * ✅ SAFE (parameterized query):
 * ```typescript
 * const stmt = db.prepare('SELECT * FROM events WHERE user = ?');
 * stmt.all(userInput);
 * ```
 *
 * ❌ UNSAFE (string concatenation):
 * ```typescript
 * db.exec(`SELECT * FROM events WHERE user = '${userInput}'`);
 * ```
 *
 * All queries in this file follow parameterized query patterns.
 * DO NOT modify to use string concatenation or template literals.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { LimitRateEvent } from '@limitrate/core';

export interface StoredEvent extends LimitRateEvent {
  id: number;
}

export interface EventStats {
  endpoint: string;
  totalHits: number;
  blocked: number;
  slowdowns: number;
}

export interface TopOffender {
  user: string;
  plan: string;
  blocks: number;
}

export class EventStorage {
  private db: Database.Database;

  constructor(dbPath: string = '.limitrate/history.db') {
    // Ensure directory exists
    const dir = join(process.cwd(), '.limitrate');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Open/create database
    this.db = new Database(join(process.cwd(), dbPath));

    // Initialize schema
    this.initSchema();

    // Auto-cleanup old events
    this.cleanup();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        user TEXT NOT NULL,
        plan TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        type TEXT NOT NULL,
        window TEXT,
        value REAL,
        threshold REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_endpoint ON events(endpoint);
      CREATE INDEX IF NOT EXISTS idx_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_user ON events(user);
      CREATE INDEX IF NOT EXISTS idx_created_at ON events(created_at);
    `);
  }

  /**
   * Save an event to storage
   *
   * SECURITY: Uses parameterized query to prevent SQL injection.
   * The `?` placeholders ensure all values are properly escaped.
   */
  saveEvent(event: LimitRateEvent): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO events (timestamp, user, plan, endpoint, type, window, value, threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        event.timestamp,
        event.user,
        event.plan,
        event.endpoint,
        event.type,
        event.window || null,
        event.value || null,
        event.threshold || null
      );
    } catch (error) {
      console.error('[LimitRate CLI] Failed to save event:', error);
    }
  }

  /**
   * Get endpoint statistics
   */
  getEndpointStats(): EventStats[] {
    const stmt = this.db.prepare(`
      SELECT
        endpoint,
        COUNT(*) as totalHits,
        SUM(CASE WHEN type IN ('rate_exceeded', 'cost_exceeded', 'blocked') THEN 1 ELSE 0 END) as blocked,
        SUM(CASE WHEN type = 'slowdown_applied' THEN 1 ELSE 0 END) as slowdowns
      FROM events
      WHERE created_at > strftime('%s', 'now') - 172800  -- Last 48 hours
      GROUP BY endpoint
      ORDER BY totalHits DESC
    `);

    return stmt.all() as EventStats[];
  }

  /**
   * Get top offenders (users with most blocks)
   *
   * SECURITY: Uses parameterized query with `?` placeholder for limit.
   * User input is safely passed as parameter, not concatenated.
   *
   * @param limit - Maximum number of offenders to return (default: 10)
   */
  getTopOffenders(limit: number = 10): TopOffender[] {
    const stmt = this.db.prepare(`
      SELECT
        user,
        plan,
        COUNT(*) as blocks
      FROM events
      WHERE type IN ('rate_exceeded', 'cost_exceeded', 'blocked')
        AND created_at > strftime('%s', 'now') - 3600  -- Last hour
      GROUP BY user, plan
      ORDER BY blocks DESC
      LIMIT ?
    `);

    return stmt.all(limit) as TopOffender[];
  }

  /**
   * Get recent events
   *
   * SECURITY: Uses parameterized query with `?` placeholder for limit.
   *
   * @param limit - Maximum number of events to return (default: 10)
   */
  getRecentEvents(limit: number = 10): StoredEvent[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(limit) as StoredEvent[];
  }

  /**
   * Clean up events older than 48 hours
   */
  cleanup(): void {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM events
        WHERE created_at < strftime('%s', 'now') - 172800
      `);

      const result = stmt.run();
      if (result.changes > 0) {
        console.log(`[LimitRate CLI] Cleaned up ${result.changes} old events`);
      }
    } catch (error) {
      console.error('[LimitRate CLI] Cleanup failed:', error);
    }
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE created_at > strftime('%s', 'now') - 172800
    `);

    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance
let storageInstance: EventStorage | null = null;

/**
 * Get or create storage instance
 */
export function getStorage(): EventStorage {
  if (!storageInstance) {
    storageInstance = new EventStorage();
  }
  return storageInstance;
}

/**
 * Save event (convenience function for middleware)
 */
export function saveEvent(event: LimitRateEvent): void {
  getStorage().saveEvent(event);
}
