/**
 * server/services/serverLifecycle.js
 * --------------------------------------------------------------------------
 * Start / stop / restart logic. Pure module — no Express, no Socket.io.
 * Emits events on the shared bus. All machine I/O is delegated to the
 * provided localExecutor.
 * --------------------------------------------------------------------------
 */
import { emit, EVENTS } from '../events/emitter.js';

/**
 * Trigger a lifecycle action for a server.
 * @param {{executor:object, registry:object}} ctx
 * @param {string} serverId
 * @param {'start'|'stop'|'restart'} action
 */
export async function lifecycle(ctx, serverId, action) {
  const { executor, registry } = ctx;
  const server = registry.get(serverId);
  const name = server?.name || serverId;
  let result;
  if (action === 'start') {
    result = await executor.startServer(serverId);
    if (result.success) emit(EVENTS.SERVER_STARTED, { serverId, serverName: name });
  } else if (action === 'stop') {
    result = await executor.stopServer(serverId);
    if (result.success) emit(EVENTS.SERVER_STOPPED, { serverId, serverName: name });
  } else if (action === 'restart') {
    emit(EVENTS.SERVER_RESTARTING, { serverId, serverName: name });
    result = await executor.restartServer(serverId);
  } else {
    return { success: false, error: { errorCode: 'BAD_INPUT', message: `Unknown action: ${action}`, serverId, retryable: false } };
  }
  emit(EVENTS.ACTIVITY, { type: `server.${action}`, serverId, serverName: name, details: `Lifecycle action: ${action}` });
  return result;
}

/** Quick health check. */
export async function status(ctx, serverId) {
  return ctx.executor.getServerStatus(serverId);
}
