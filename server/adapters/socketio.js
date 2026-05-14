/**
 * server/adapters/socketio.js
 * --------------------------------------------------------------------------
 * Socket.io adapter — bridges the internal event bus + live log/stats
 * services to clients. Handlers stay thin: subscribe/unsubscribe rooms,
 * dispatch to services, forward events.
 * --------------------------------------------------------------------------
 */
import { on, EVENTS } from '../events/emitter.js';

/**
 * Wire socket handlers and event forwarders.
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {object} deps.ctx { executor, registry, rconManager }
 * @param {object} deps.statsService
 * @param {object} deps.logService
 */
export function registerSocketAdapter({ io, ctx, statsService, logService }) {
  const { registry } = ctx;

  // ---- Forward bus events into Socket.io rooms
  on(EVENTS.STATS_UPDATED, (payload) => {
    io.to('stats').emit('stats:update', { serverId: payload.serverId, point: payload.point, rcon: payload.rcon });
    io.to(`stats:${payload.serverId}`).emit('stats:update', { serverId: payload.serverId, point: payload.point, rcon: payload.rcon });
  });
  on(EVENTS.LOG_LINE, (payload) => {
    io.to(`console:${payload.serverId}`).emit('console:line', payload);
  });
  on(EVENTS.RCON_CONNECTED, (payload) => io.to('stats').emit('stats:rcon', { serverId: payload.serverId, rcon: { connected: true, lastSuccessAt: payload.ts, lastError: null } }));
  on(EVENTS.RCON_DISCONNECTED, (payload) => io.to('stats').emit('stats:rcon', { serverId: payload.serverId, rcon: { connected: false, lastSuccessAt: null, lastError: payload.error || null } }));

  // ---- Per-socket subscriptions
  const consoleUnsubs = new WeakMap();

  io.on('connection', (socket) => {
    socket.on('stats:subscribe', ({ serverId } = {}) => {
      socket.join('stats');
      if (serverId) {
        socket.join(`stats:${serverId}`);
        socket.emit('stats:history', { serverId, history: statsService.getHistory(serverId), rcon: ctx.rconManager.status(serverId) });
      } else {
        socket.emit('stats:snapshot', statsService.snapshot());
      }
    });
    socket.on('stats:unsubscribe', ({ serverId } = {}) => {
      if (serverId) socket.leave(`stats:${serverId}`);
    });

    socket.on('console:subscribe', ({ serverId } = {}) => {
      if (!serverId || !registry.get(serverId)) return;
      socket.join(`console:${serverId}`);
      // Replay backlog to the joiner
      socket.emit('console:replay', { serverId, lines: logService.backlog(serverId) });
      // Register a listener so the stream starts even with no prior subscribers
      const unsub = logService.subscribe(serverId, () => { /* fanout happens via bus */ });
      const prior = consoleUnsubs.get(socket) || new Map();
      prior.set(serverId, unsub);
      consoleUnsubs.set(socket, prior);
    });
    socket.on('console:unsubscribe', ({ serverId } = {}) => {
      socket.leave(`console:${serverId}`);
      const map = consoleUnsubs.get(socket);
      const unsub = map?.get(serverId);
      if (unsub) { unsub(); map.delete(serverId); }
    });

    socket.on('disconnect', () => {
      const map = consoleUnsubs.get(socket);
      if (!map) return;
      for (const u of map.values()) try { u(); } catch {}
      consoleUnsubs.delete(socket);
    });
  });
}
