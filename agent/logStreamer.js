/**
 * agent/logStreamer.js
 * --------------------------------------------------------------------------
 * Watches a server's log file with chokidar and fans out new lines to
 * registered callbacks. Handles log rotation, ring-buffers a backlog, and
 * tears down cleanly. Also accepts "synthetic" log lines from the process
 * manager (server stdout/stderr) so vanilla servers that don't write to a
 * file still stream live.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { logger } from './logger.js';

/** Default location of the server log relative to the server's directory. */
function defaultLogPath(server) {
  return path.join(server.directory, 'logs', 'latest.log');
}

export class LogStreamer {
  /** @param {number} maxBacklog */
  constructor(maxBacklog = 500) {
    this.maxBacklog = maxBacklog;
    /** @type {Map<string,{watcher:any|null,fd:number|null,offset:number,listeners:Set<Function>,backlog:string[],pendingPartial:string,watchPath:string}>} */
    this.streams = new Map();
  }

  /** Subscribe to a server's log lines. Returns unsubscribe fn. */
  subscribe(server, fn) {
    const id = server.id;
    let entry = this.streams.get(id);
    if (!entry) {
      entry = {
        watcher: null, fd: null, offset: 0, listeners: new Set(),
        backlog: [], pendingPartial: '', watchPath: defaultLogPath(server),
      };
      this.streams.set(id, entry);
      this._attach(server, entry).catch((err) => logger.warn('logStreamer.attach.failed', { serverId: id, error: err.message }));
    }
    entry.listeners.add(fn);
    // Replay backlog
    try { fn({ serverId: id, replay: true, lines: entry.backlog.slice() }); } catch {}
    return () => {
      entry.listeners.delete(fn);
      if (entry.listeners.size === 0) this._detach(id);
    };
  }

  /** Push a synthetic line (e.g. from the child process stdout). */
  pushLine(serverId, line) {
    let entry = this.streams.get(serverId);
    if (!entry) {
      // Create a backlog-only entry so future subscribers see history
      entry = { watcher: null, fd: null, offset: 0, listeners: new Set(), backlog: [], pendingPartial: '', watchPath: null };
      this.streams.set(serverId, entry);
    }
    entry.backlog.push(line);
    if (entry.backlog.length > this.maxBacklog) entry.backlog.shift();
    for (const fn of entry.listeners) {
      try { fn({ serverId, line, ts: Date.now() }); } catch {}
    }
  }

  backlog(serverId) { return (this.streams.get(serverId)?.backlog || []).slice(); }

  async _attach(server, entry) {
    const target = entry.watchPath;
    if (!target) return;
    try {
      const stat = await fs.promises.stat(target);
      entry.offset = stat.size;
      // Pre-load the last ~maxBacklog lines as initial backlog
      const initial = await this._readTail(target, this.maxBacklog);
      for (const l of initial) {
        entry.backlog.push(l);
        if (entry.backlog.length > this.maxBacklog) entry.backlog.shift();
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        entry.offset = 0;
        // OK — file will appear later
      } else { throw err; }
    }
    const watcher = chokidar.watch(target, { persistent: true, awaitWriteFinish: false, usePolling: false, ignoreInitial: true });
    watcher.on('add', () => { entry.offset = 0; this._readNew(server.id, target, entry); });
    watcher.on('change', () => { this._readNew(server.id, target, entry); });
    // Handle rotation: file removed → reset offset, wait for re-add
    watcher.on('unlink', () => { entry.offset = 0; entry.pendingPartial = ''; });
    entry.watcher = watcher;
  }

  async _readNew(serverId, target, entry) {
    let stat;
    try { stat = await fs.promises.stat(target); } catch { return; }
    if (stat.size < entry.offset) entry.offset = 0; // truncation
    if (stat.size === entry.offset) return;
    const length = stat.size - entry.offset;
    const buf = Buffer.alloc(length);
    let fh;
    try {
      fh = await fs.promises.open(target, 'r');
      await fh.read(buf, 0, length, entry.offset);
    } catch (err) {
      logger.warn('logStreamer.read.failed', { serverId, error: err.message });
      return;
    } finally { await fh?.close().catch(() => {}); }
    entry.offset = stat.size;
    const text = entry.pendingPartial + buf.toString('utf8');
    const parts = text.split(/\r?\n/);
    entry.pendingPartial = parts.pop();
    for (const line of parts) {
      if (!line) continue;
      entry.backlog.push(line);
      if (entry.backlog.length > this.maxBacklog) entry.backlog.shift();
      for (const fn of entry.listeners) {
        try { fn({ serverId, line, ts: Date.now() }); } catch {}
      }
    }
  }

  async _readTail(target, maxLines) {
    try {
      const text = await fs.promises.readFile(target, 'utf8');
      const lines = text.split(/\r?\n/);
      return lines.slice(Math.max(0, lines.length - maxLines)).filter(Boolean);
    } catch { return []; }
  }

  _detach(serverId) {
    const entry = this.streams.get(serverId);
    if (!entry) return;
    try { entry.watcher?.close(); } catch {}
    this.streams.delete(serverId);
  }

  /** Stop everything (shutdown). */
  closeAll() {
    for (const id of Array.from(this.streams.keys())) this._detach(id);
  }
}
