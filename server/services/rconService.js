/**
 * server/services/rconService.js
 * --------------------------------------------------------------------------
 * RCON commands. All sends go through executor.executeRcon.
 * --------------------------------------------------------------------------
 */
import { emit, EVENTS } from '../events/emitter.js';

/**
 * Send a raw RCON command.
 * @param {{executor:object, registry:object}} ctx
 * @param {string} serverId
 * @param {string} command
 */
export async function send(ctx, serverId, command) {
  const { executor, registry } = ctx;
  const res = await executor.executeRcon(serverId, command);
  emit(EVENTS.ACTIVITY, {
    type: 'console.command',
    serverId,
    serverName: registry.get(serverId)?.name,
    details: command,
  });
  return res;
}

/** Player roster from `list`. Returns `[]` on RCON failure. */
export async function listOnlinePlayers(ctx, serverId) {
  const res = await ctx.executor.executeRcon(serverId, 'list');
  if (!res.success) return [];
  const resp = res.data?.response || '';
  const idx = resp.indexOf(':');
  if (idx === -1) return [];
  return resp.slice(idx + 1).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Whitelist add/remove. */
export async function setWhitelist(ctx, serverId, name, action) {
  const cmd = action === 'remove' ? `whitelist remove ${name}` : `whitelist add ${name}`;
  return ctx.executor.executeRcon(serverId, cmd);
}

/** Ban variants. */
export async function ban(ctx, serverId, { name, ip, mode, reason }) {
  let cmd;
  if (mode === 'ip') cmd = `ban-ip ${ip || name} ${reason || ''}`.trim();
  else if (mode === 'pardon') cmd = `pardon ${name}`;
  else if (mode === 'pardon-ip') cmd = `pardon-ip ${ip || name}`;
  else cmd = `ban ${name} ${reason || ''}`.trim();
  return ctx.executor.executeRcon(serverId, cmd);
}

/** Kick a player. */
export async function kick(ctx, serverId, name, reason = '') {
  return ctx.executor.executeRcon(serverId, `kick ${name} ${reason}`.trim());
}
