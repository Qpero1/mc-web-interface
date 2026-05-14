/**
 * server/activityLog.js
 * --------------------------------------------------------------------------
 * Persistent activity log. Tries SQLite (better-sqlite3) first; if that
 * native module isn't usable on this platform, falls back to a flat JSON
 * file. Either way, the public API is the same.
 * --------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Activity log persisted server-side. Used by every module to record actions.
 */
export class ActivityLog {
  /**
   * @param {object} config Loaded panel config.
   * @param {string} rootDir Project root.
   */
  constructor(config, rootDir) {
    this.config = config;
    this.rootDir = rootDir;
    this.driver = config.activityLog.driver === 'sqlite' ? 'sqlite' : 'json';
    this.maxEntries = config.activityLog.maxEntries || 5000;
    this.db = null;
    this.jsonEntries = [];
    this.jsonPath = config.activityLog.jsonFallbackPath;
  }

  /**
   * Open the underlying store. Falls back to JSON if SQLite cannot load.
   */
  async init() {
    await fs.mkdir(path.dirname(this.jsonPath), { recursive: true });
    if (this.driver === 'sqlite') {
      try {
        const mod = await import('better-sqlite3');
        const Database = mod.default || mod;
        await fs.mkdir(path.dirname(this.config.activityLog.path), { recursive: true });
        this.db = new Database(this.config.activityLog.path);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            type TEXT NOT NULL,
            server_id TEXT,
            server_name TEXT,
            details TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity (ts DESC);
        `);
        return;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[activityLog] SQLite unavailable, using JSON fallback:', err.message);
        this.driver = 'json';
      }
    }
    // JSON driver
    try {
      const data = await fs.readFile(this.jsonPath, 'utf8');
      this.jsonEntries = JSON.parse(data);
      if (!Array.isArray(this.jsonEntries)) this.jsonEntries = [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // eslint-disable-next-line no-console
        console.warn('[activityLog] failed to read JSON store:', err.message);
      }
      this.jsonEntries = [];
    }
  }

  /**
   * Record a new activity entry.
   * @param {{type:string, serverId?:string, serverName?:string, details?:string}} entry
   */
  record(entry) {
    const row = {
      ts: Date.now(),
      type: entry.type || 'unknown',
      serverId: entry.serverId || null,
      serverName: entry.serverName || null,
      details: entry.details || '',
    };
    if (this.driver === 'sqlite' && this.db) {
      this.db.prepare(
        'INSERT INTO activity (ts, type, server_id, server_name, details) VALUES (?, ?, ?, ?, ?)'
      ).run(row.ts, row.type, row.serverId, row.serverName, row.details);
      // Trim oldest beyond maxEntries
      this.db.prepare(`
        DELETE FROM activity WHERE id IN (
          SELECT id FROM activity ORDER BY id DESC LIMIT -1 OFFSET ?
        )`).run(this.maxEntries);
    } else {
      this.jsonEntries.unshift(row);
      if (this.jsonEntries.length > this.maxEntries) {
        this.jsonEntries.length = this.maxEntries;
      }
      this._flushJsonSoon();
    }
  }

  /**
   * Read the most recent N entries.
   * @param {number} limit
   * @returns {Array<object>}
   */
  recent(limit = 100) {
    if (this.driver === 'sqlite' && this.db) {
      const rows = this.db
        .prepare('SELECT ts, type, server_id as serverId, server_name as serverName, details FROM activity ORDER BY ts DESC LIMIT ?')
        .all(limit);
      return rows;
    }
    return this.jsonEntries.slice(0, limit);
  }

  _flushJsonSoon() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(async () => {
      this._flushTimer = null;
      try {
        const tmp = this.jsonPath + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(this.jsonEntries, null, 2));
        await fs.rename(tmp, this.jsonPath);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[activityLog] flush failed:', err.message);
      }
    }, 300);
  }

  /**
   * Close the underlying store. Flushes pending writes.
   */
  async close() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
      try {
        fsSync.writeFileSync(this.jsonPath, JSON.stringify(this.jsonEntries, null, 2));
      } catch (_err) { /* ignore */ }
    }
    if (this.db) {
      try { this.db.close(); } catch (_err) { /* ignore */ }
      this.db = null;
    }
  }
}
