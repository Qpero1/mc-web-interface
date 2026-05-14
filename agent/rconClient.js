/**
 * agent/rconClient.js
 * --------------------------------------------------------------------------
 * Per-server pooled RCON client. Polls for readiness during startup with
 * exponential backoff, auto-reconnects on drop, and never blocks the agent.
 * --------------------------------------------------------------------------
 */
import { Rcon } from 'rcon-client';
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export class RconClientManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string,{conn:Rcon|null, server:object, reconnectTimer:any, reconnectDelay:number, connecting:boolean, polling:boolean}>} */
    this.entries = new Map();
  }

  _get(serverId) {
    return this.entries.get(serverId);
  }

  _ensure(server) {
    let entry = this.entries.get(server.id);
    if (!entry) {
      entry = { conn: null, server, reconnectTimer: null, reconnectDelay: RECONNECT_MIN_MS, connecting: false, polling: false };
      this.entries.set(server.id, entry);
    }
    return entry;
  }

  /**
   * Mark a server as starting and begin polling for RCON readiness with
   * exponential backoff up to `timeoutMs`. Emits `ready` or `give-up`.
   */
  async waitForReady(server, timeoutMs = 120000) {
    const entry = this._ensure(server);
    if (entry.polling) return;
    entry.polling = true;
    const start = Date.now();
    let delay = 1000;
    this.emit('connecting', { serverId: server.id });
    while (Date.now() - start < timeoutMs) {
      try {
        await this._connect(server);
        entry.polling = false;
        return true;
      } catch (err) {
        await sleep(delay);
        delay = Math.min(delay * 1.5, 8000);
      }
    }
    entry.polling = false;
    this.emit('give-up', { serverId: server.id, reason: 'timeout' });
    return false;
  }

  async _connect(server) {
    const entry = this._ensure(server);
    if (entry.connecting) throw Object.assign(new Error('already connecting'), { code: 'BUSY' });
    if (entry.conn?.authenticated) return entry.conn;
    entry.connecting = true;
    try {
      const rcon = new Rcon({ host: '127.0.0.1', port: server.rconPort, password: server.rconPassword, timeout: 5000 });
      rcon.on('end', () => this._handleDisconnect(server.id));
      rcon.on('error', (err) => logger.debug('rcon.error', { serverId: server.id, error: err.message }));
      await rcon.connect();
      entry.conn = rcon;
      entry.reconnectDelay = RECONNECT_MIN_MS;
      this.emit('ready', { serverId: server.id });
      logger.info('rcon.ready', { serverId: server.id });
      return rcon;
    } finally { entry.connecting = false; }
  }

  _handleDisconnect(serverId) {
    const entry = this._get(serverId);
    if (!entry) return;
    entry.conn = null;
    this.emit('disconnected', { serverId });
    // Auto-reconnect with backoff
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = setTimeout(async () => {
      try { await this._connect(entry.server); }
      catch (_e) {
        entry.reconnectDelay = Math.min(entry.reconnectDelay * 2, RECONNECT_MAX_MS);
        this._handleDisconnect(serverId);
      }
    }, entry.reconnectDelay);
    entry.reconnectTimer.unref?.();
  }

  /** Send an RCON command. Times out after `timeoutMs`. */
  async send(server, command, timeoutMs = 8000) {
    const entry = this._ensure(server);
    if (!entry.conn?.authenticated) await this._connect(server);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('RCON timed out'), { code: 'TIMEOUT' })), timeoutMs);
      entry.conn.send(command).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
    });
  }

  isReady(serverId) {
    const entry = this._get(serverId);
    return !!entry?.conn?.authenticated;
  }

  /** Disconnect everything (shutdown). */
  async disposeAll() {
    for (const entry of this.entries.values()) {
      try { await entry.conn?.end(); } catch {}
      clearTimeout(entry.reconnectTimer);
    }
    this.entries.clear();
  }

  /** Mark a server as "definitely stopped" so we stop auto-reconnecting. */
  forget(serverId) {
    const entry = this._get(serverId);
    if (!entry) return;
    clearTimeout(entry.reconnectTimer);
    try { entry.conn?.end(); } catch {}
    this.entries.delete(serverId);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
