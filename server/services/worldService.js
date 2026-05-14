/**
 * server/services/worldService.js
 * --------------------------------------------------------------------------
 * World folder discovery, upload (zip + extract), set active (level-name),
 * download, delete.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import extract from 'extract-zip';
import { emit, EVENTS } from '../events/emitter.js';

/** Read server.properties as key→value map. */
async function readServerProperties(sftp, root) {
  try {
    const buf = await sftp.get(`${root}/server.properties`);
    const txt = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    const out = {};
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
  } catch { return {}; }
}

async function updateProperty(sftp, root, key, value) {
  let txt = '';
  try { const b = await sftp.get(`${root}/server.properties`); txt = Buffer.isBuffer(b) ? b.toString('utf8') : String(b); } catch {}
  const lines = txt.split(/\r?\n/);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    const idx = lines[i].indexOf('=');
    if (idx === -1) continue;
    if (lines[i].slice(0, idx).trim() === key) { lines[i] = `${key}=${value}`; found = true; break; }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sftp.put(Readable.from(lines.join('\n')), `${root}/server.properties`);
}

/** List worlds (folders containing level.dat) plus the active one. */
export async function list(ctx, serverId) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const entries = await conn.sftp.list(root);
    const props = await readServerProperties(conn.sftp, root);
    const active = props['level-name'] || 'world';
    const worlds = [];
    for (const e of entries) {
      if (e.type !== 'd') continue;
      const hasLevel = await conn.sftp.exists(`${root}/${e.name}/level.dat`);
      if (hasLevel) worlds.push({ name: e.name, active: e.name === active, modifyTime: e.modifyTime });
    }
    return { success: true, data: { worlds, activeWorld: active } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Upload + extract a world zip. */
export async function uploadZip(ctx, serverId, buffer) {
  const conn = await ctx.executor.openSftp(serverId);
  const tmpZip = path.join(os.tmpdir(), `mcpanel-world-${Date.now()}.zip`);
  const tmpDir = path.join(os.tmpdir(), `mcpanel-extract-${Date.now()}`);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    await fsp.writeFile(tmpZip, buffer);
    await fsp.mkdir(tmpDir, { recursive: true });
    await extract(tmpZip, { dir: tmpDir });
    const worldRoot = await findWorldRoot(tmpDir);
    if (!worldRoot) {
      return { success: false, error: { errorCode: 'NO_LEVEL_DAT', message: 'Zip does not contain a Minecraft world (no level.dat)', serverId, retryable: false } };
    }
    const worldName = path.basename(worldRoot);
    await conn.sftp.mkdir(`${root}/${worldName}`, true);
    await uploadDirectory(conn.sftp, worldRoot, `${root}/${worldName}`);
    emit(EVENTS.ACTIVITY, { type: 'worlds.upload', serverId, details: worldName });
    return { success: true, data: { name: worldName } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally {
    await conn.sftp.end().catch(() => {});
    fsp.unlink(tmpZip).catch(() => {});
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Mark a world active by editing level-name in server.properties. */
export async function setActive(ctx, serverId, name) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const exists = await conn.sftp.exists(`${root}/${name}/level.dat`);
    if (!exists) return { success: false, error: { errorCode: 'WORLD_NOT_FOUND', message: `World "${name}" not found`, serverId, retryable: false } };
    await updateProperty(conn.sftp, root, 'level-name', name);
    emit(EVENTS.ACTIVITY, { type: 'worlds.set-active', serverId, details: name });
    return { success: true, data: { activeWorld: name } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Delete a world folder. */
export async function remove(ctx, serverId, name) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    await conn.sftp.rmdir(`${root}/${name}`, true);
    emit(EVENTS.ACTIVITY, { type: 'worlds.delete', serverId, details: name });
    return { success: true, data: { ok: true } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/**
 * Stream a world as a zip into the supplied writable (HTTP response).
 * Returns a promise that resolves when done.
 */
export async function downloadZip(ctx, serverId, name, writable) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const worldRemote = `${root}/${name}`;
    const exists = await conn.sftp.exists(worldRemote);
    if (!exists) {
      return { success: false, error: { errorCode: 'WORLD_NOT_FOUND', message: `World "${name}" not found`, serverId, retryable: false } };
    }
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(writable);
    await streamDirToZip(conn.sftp, worldRemote, name, archive);
    await archive.finalize();
    return { success: true, data: { ok: true } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

async function findWorldRoot(localDir) {
  if (fs.existsSync(path.join(localDir, 'level.dat'))) return localDir;
  const entries = await fsp.readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(localDir, e.name);
    if (fs.existsSync(path.join(sub, 'level.dat'))) return sub;
  }
  return null;
}

async function uploadDirectory(sftp, localDir, remoteDir) {
  await sftp.mkdir(remoteDir, true);
  const entries = await fsp.readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    const lp = path.join(localDir, e.name); const rp = `${remoteDir}/${e.name}`;
    if (e.isDirectory()) await uploadDirectory(sftp, lp, rp);
    else if (e.isFile()) await sftp.fastPut(lp, rp);
  }
}

async function streamDirToZip(sftp, remoteDir, prefix, archive) {
  const entries = await sftp.list(remoteDir);
  for (const e of entries) {
    const rp = `${remoteDir}/${e.name}`;
    const zp = `${prefix}/${e.name}`;
    if (e.type === 'd') await streamDirToZip(sftp, rp, zp, archive);
    else if (e.type === '-') archive.append(await sftp.get(rp), { name: zp });
  }
}
