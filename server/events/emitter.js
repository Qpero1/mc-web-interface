/**
 * server/events/emitter.js
 * --------------------------------------------------------------------------
 * Internal event bus. Domain services emit semantic events here (e.g.
 * `server:started`, `backup:created`); transport adapters (Socket.io, REST
 * webhooks, future cloud adapter) subscribe and forward them outward.
 *
 * Using a single shared EventEmitter keeps the services transport-agnostic.
 * --------------------------------------------------------------------------
 */
import { EventEmitter } from 'node:events';

/** @type {EventEmitter} */
const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Canonical event names. */
export const EVENTS = Object.freeze({
  SERVER_STARTED: 'server:started',
  SERVER_STOPPED: 'server:stopped',
  SERVER_CRASHED: 'server:crashed',
  SERVER_RESTARTING: 'server:restarting',
  BACKUP_CREATED: 'backup:created',
  BACKUP_FAILED: 'backup:failed',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  FILE_CHANGED: 'file:changed',
  RCON_CONNECTED: 'rcon:connected',
  RCON_DISCONNECTED: 'rcon:disconnected',
  STATS_UPDATED: 'stats:updated',
  LOG_LINE: 'log:line',
  ACTIVITY: 'activity',
});

/**
 * Emit an event on the shared bus.
 * @param {string} event One of EVENTS.*
 * @param {object} payload Arbitrary payload (will be JSON-serialized for transports)
 */
export function emit(event, payload = {}) {
  bus.emit(event, { event, ts: Date.now(), ...payload });
}

/**
 * Subscribe to an event. Returns an unsubscribe function.
 * @param {string} event
 * @param {(payload:object)=>void} handler
 */
export function on(event, handler) {
  bus.on(event, handler);
  return () => bus.off(event, handler);
}

/** Subscribe to any event (useful for cloud forwarding / activity log). */
export function onAny(handler) {
  for (const e of Object.values(EVENTS)) bus.on(e, (p) => handler(e, p));
}

export { bus };
