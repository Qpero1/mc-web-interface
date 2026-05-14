/**
 * agent/heartbeat.js
 * --------------------------------------------------------------------------
 * Periodic health reporter. Emits an `agent:heartbeat` log line on a
 * configurable interval summarizing per-server state. Designed to be
 * consumed later by the cloud connector.
 * --------------------------------------------------------------------------
 */
import { logger } from './logger.js';

export class Heartbeat {
  /** @param {object} deps { stateManager, processManager, rcon, intervalMs } */
  constructor({ stateManager, processManager, rcon, intervalMs = 10000 }) {
    this.stateManager = stateManager;
    this.processManager = processManager;
    this.rcon = rcon;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.max(2000, this.intervalMs));
    this.timer.unref?.();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  tick() {
    const allStates = this.stateManager.getAllStates();
    const summary = { agent: 'alive', servers: {} };
    for (const [id, state] of Object.entries(allStates)) {
      summary.servers[id] = {
        process: state.process,
        rcon: this.rcon?.isReady(id) ? 'ready' : (state.rcon || 'disconnected'),
        pid: state.pid,
        startedAt: state.startedAt,
      };
    }
    logger.debug('agent.heartbeat', summary);
  }
}
