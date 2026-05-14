/**
 * server/services/modService.js
 * --------------------------------------------------------------------------
 * Mod management — lists, toggles, deletes mod jars under /mods.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import { Readable } from 'node:stream';
import { emit, EVENTS } from '../events/emitter.js';

const MODS_DIR = '/mods';

/** List all .jar / .jar.disabled files. */
export async function list(ctx, serverId) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const dir = root + MODS_DIR;
    try { await conn.sftp.stat(dir); } catch { await conn.sftp.mkdir(dir, true); }
    const entries = await conn.sftp.list(dir);
    return { success: true, data: { mods: entries
      .filter((e) => e.type === '-' && (/\.jar$/i.test(e.name) || /\.jar\.disabled$/i.test(e.name)))
      .map((e) => ({ name: e.name, size: e.size, modifyTime: e.modifyTime, enabled: /\.jar$/i.test(e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)) } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Upload one or more mod files (buffers). */
export async function upload(ctx, serverId, files) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const dir = root + MODS_DIR;
    try { await conn.sftp.stat(dir); } catch { await conn.sftp.mkdir(dir, true); }
    const uploaded = [];
    for (const f of files) {
      const safe = path.posix.basename(f.originalname || f.name);
      await conn.sftp.put(Readable.from(f.buffer), `${dir}/${safe}`);
      uploaded.push(safe);
    }
    emit(EVENTS.ACTIVITY, { type: 'mods.upload', serverId, details: uploaded.join(', ') });
    return { success: true, data: { uploaded } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Toggle a mod's `.jar` / `.jar.disabled` state. */
export async function toggle(ctx, serverId, name, enabled) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const dir = root + MODS_DIR;
    const from = `${dir}/${path.posix.basename(name)}`;
    const isEnabled = /\.jar$/i.test(name);
    const target = (enabled === true || (enabled === undefined && !isEnabled))
      ? from.replace(/\.jar\.disabled$/i, '.jar')
      : from.replace(/\.jar$/i, '.jar.disabled');
    if (from === target) return { success: true, data: { unchanged: true } };
    await conn.sftp.rename(from, target);
    emit(EVENTS.ACTIVITY, { type: 'mods.toggle', serverId, details: `${path.posix.basename(name)} → ${path.posix.basename(target)}` });
    return { success: true, data: { name: path.posix.basename(target) } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Delete a mod jar. */
export async function remove(ctx, serverId, name) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const target = `${root}${MODS_DIR}/${path.posix.basename(name)}`;
    await conn.sftp.delete(target);
    emit(EVENTS.ACTIVITY, { type: 'mods.delete', serverId, details: name });
    return { success: true, data: { ok: true } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}
