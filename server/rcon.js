/**
 * server/rcon.js
 * --------------------------------------------------------------------------
 * Pooled RCON connections per server, with health tracking. Exposes:
 *   - send(id, command)
 *   - status(id) → { connected, lastSuccessAt, lastError }
 *   - disposeAll() for shutdown
 *
 * Connections are lazy and reused; if a send fails the connection is
 * discarded and re-opened on the next request.
 * --------------------------------------------------------------------------
 */
import { Rcon } from 'rcon-client';

/**
 * Manages pooled RCON clients for every configured server.
 */
export class RconManager {
  /**
   * @param {import('./servers.js').ServerRegistry} registry
   * @param {object} config
   */
  constructor(registry, config) {
    this.registry = registry;
    this.config = config;
    /** @type {Map<string, Rcon>} */
    this.connections = new Map();
    /** @type {Map<string, {connected:boolean,lastSuccessAt:number|null,lastError:string|null}>} */
    this.health = new Map();
  }

  _setHealth(id, patch) {
    const prev = this.health.get(id) || { connected: false, lastSuccessAt: null, lastError: null };
    this.health.set(id, { ...prev, ...patch });
  }

  /**
   * Get cached health info for a server.
   * @param {string} id
   */
  status(id) {
    return this.health.get(id) || { connected: false, lastSuccessAt: null, lastError: null };
  }

  /**
   * Ensure a live, connected client exists for the server. Throws on failure.
   * @param {string} id
   */
  async _ensure(id) {
    const existing = this.connections.get(id);
    if (existing && existing.authenticated && !existing.socket?.destroyed) {
      return existing;
    }
    const server = this.registry.require(id);
    const rcon = new Rcon({
      host: server.host,
      port: server.rcon.port,
      password: server.rcon.password,
      timeout: 5000,
    });
    rcon.on('end', () => {
      this.connections.delete(id);
      this._setHealth(id, { connected: false });
    });
    rcon.on('error', (err) => {
      this._setHealth(id, { connected: false, lastError: err.message });
    });
    await rcon.connect();
    this.connections.set(id, rcon);
    this._setHealth(id, { connected: true, lastSuccessAt: Date.now(), lastError: null });
    return rcon;
  }

  /**
   * Send an RCON command. On any failure the cached connection is closed.
   * @param {string} id
   * @param {string} command
   * @returns {Promise<string>}
   */
  async send(id, command) {
    try {
      const rcon = await this._ensure(id);
      const response = await rcon.send(command);
      this._setHealth(id, { connected: true, lastSuccessAt: Date.now(), lastError: null });
      return response;
    } catch (err) {
      const existing = this.connections.get(id);
      if (existing) {
        try { await existing.end(); } catch (_e) { /* ignore */ }
      }
      this.connections.delete(id);
      this._setHealth(id, { connected: false, lastError: err.message });
      throw err;
    }
  }

  /**
   * Probe connectivity without running a meaningful command.
   * @param {string} id
   */
  async probe(id) {
    try {
      await this.send(id, 'list');
      return true;
    } catch (_err) {
      return false;
    }
  }

  async disposeAll() {
    const all = Array.from(this.connections.values());
    this.connections.clear();
    await Promise.all(all.map((c) => c.end().catch(() => {})));
  }
}
