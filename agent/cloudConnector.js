/**
 * agent/cloudConnector.js
 * --------------------------------------------------------------------------
 * Cloud connector — STUB for Phase 3. This is the hook point where, in a
 * later phase, the agent will open a websocket to the cloud control plane,
 * receive remote jobs, and forward events. Today it does nothing.
 * --------------------------------------------------------------------------
 */
import { logger } from './logger.js';

export class CloudConnector {
  constructor() { this.connected = false; }
  start() { logger.debug('cloud.disabled', { reason: 'cloud features not implemented in this phase' }); }
  stop() {}
}
