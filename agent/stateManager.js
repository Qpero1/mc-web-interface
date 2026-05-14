/**
 * agent/stateManager.js
 * --------------------------------------------------------------------------
 * Per-server state machine. States:
 *   process: starting | online | stopping | offline | crashed
 *   rcon:    connecting | ready | disconnected
 *
 * State changes are emitted via the EventEmitter for downstream consumers
 * and persisted to disk so they survive an agent restart. On restart,
 * `reconcile()` checks if recorded PIDs are still alive and corrects state.
 * --------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

const PROCESS_STATES = new Set(['starting', 'online', 'stopping', 'offline', 'crashed']);
const RCON_STATES = new Set(['connecting', 'ready', 'disconnected']);

export class StateManager extends EventEmitter {
  /**
   * @param {string} persistPath
   * @param {ProcessManager} processManager
   */
  constructor(persistPath, processManager) {
    super();
    this.path = persistPath;
    this.proc = processManager;
    /** @type {Map<string,{process:string,rcon:string,pid:number|null,updatedAt:number,startedAt:number|null,crash:{code:number|null,signal:string|null,recentLog:string[]}|null}>} */
    this.states = new Map();
    this._flushTimer = null;
  }

  /** Load persisted state file (if any). */
  async init() {
    try {
      const text = await fs.readFile(this.path, 'utf8');
      const parsed = JSON.parse(text);
      for (const [id, v] of Object.entries(parsed)) this.states.set(id, v);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('state.load.failed', { error: err.message });
    }
  }

  getState(serverId) {
    return this.states.get(serverId) || { process: 'offline', rcon: 'disconnected', pid: null, updatedAt: Date.now(), startedAt: null, crash: null };
  }

  getAllStates() {
    const out = {};
    for (const [id, v] of this.states.entries()) out[id] = v;
    return out;
  }

  /**
   * Update a server's state. Partial — fields not provided are preserved.
   * @param {string} serverId
   * @param {{process?:string,rcon?:string,pid?:number|null,startedAt?:number|null,crash?:object|null}} patch
   */
  setState(serverId, patch) {
    const cur = this.getState(serverId);
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    if (patch.process && !PROCESS_STATES.has(patch.process)) throw new Error(`Invalid process state: ${patch.process}`);
    if (patch.rcon && !RCON_STATES.has(patch.rcon)) throw new Error(`Invalid rcon state: ${patch.rcon}`);
    this.states.set(serverId, next);
    this.emit('change', { serverId, state: next, prev: cur });
    this._scheduleFlush();
    return next;
  }

  /** Reconcile in-memory/disk state against reality. */
  async reconcile(servers) {
    const summary = { rebornAsCrashed: [], reattached: [], cleaned: [] };
    for (const server of servers) {
      const cur = this.getState(server.id);
      const wasRunning = cur.process === 'online' || cur.process === 'starting';
      if (!wasRunning) continue;
      const pid = cur.pid;
      if (pid && this.proc.isPidAlive(pid)) {
        // Process still alive — re-attach as online (RCON will reconnect separately)
        this.setState(server.id, { process: 'online', rcon: 'disconnected', startedAt: cur.startedAt || Date.now() });
        summary.reattached.push(server.id);
      } else {
        // PID is gone: mark crashed
        this.setState(server.id, { process: 'crashed', rcon: 'disconnected', pid: null, crash: { code: null, signal: null, recentLog: [] } });
        summary.rebornAsCrashed.push(server.id);
      }
    }
    logger.info('state.reconcile', summary);
    this.emit('reconciled', summary);
    return summary;
  }

  _scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(async () => {
      this._flushTimer = null;
      try {
        const obj = Object.fromEntries(this.states.entries());
        const tmp = this.path + '.tmp';
        await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
        await fs.rename(tmp, this.path);
      } catch (err) {
        logger.warn('state.persist.failed', { error: err.message });
      }
    }, 250);
  }

  /** Flush synchronously on shutdown. */
  async flushNow() {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = null;
    const obj = Object.fromEntries(this.states.entries());
    await fs.writeFile(this.path, JSON.stringify(obj, null, 2));
  }
}
