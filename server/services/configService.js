/**
 * server/services/configService.js
 * --------------------------------------------------------------------------
 * server.properties parse / write. Comments and blank lines are preserved.
 * --------------------------------------------------------------------------
 */
import { Readable } from 'node:stream';
import { emit, EVENTS } from '../events/emitter.js';

/** Parse text into ordered entries. */
export function parseProperties(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line === '') { out.push({ kind: 'blank' }); continue; }
    if (line.startsWith('#')) { out.push({ kind: 'comment', text: line.slice(1).trim() }); continue; }
    const idx = line.indexOf('=');
    if (idx === -1) { out.push({ kind: 'comment', text: line }); continue; }
    out.push({ kind: 'pair', key: line.slice(0, idx).trim(), value: line.slice(idx + 1) });
  }
  return out;
}

export function serializeProperties(entries) {
  return entries.map((e) => {
    if (e.kind === 'pair') return `${e.key}=${e.value ?? ''}`;
    if (e.kind === 'comment') return `#${e.text || ''}`;
    return '';
  }).join('\n');
}

/** Read and parse the remote server.properties. */
export async function readProperties(ctx, serverId) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const p = `${root}/server.properties`;
    const exists = await conn.sftp.exists(p);
    const text = exists ? (await conn.sftp.get(p)).toString('utf8') : '';
    return { success: true, data: { raw: text, entries: parseProperties(text) } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

/** Write the remote server.properties (either raw text or entries). */
export async function writeProperties(ctx, serverId, { raw, entries }) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const p = `${root}/server.properties`;
    let body;
    if (typeof raw === 'string') body = raw;
    else if (Array.isArray(entries)) body = serializeProperties(entries);
    else return { success: false, error: { errorCode: 'BAD_INPUT', message: 'Provide raw or entries', serverId, retryable: false } };
    const header = `#Minecraft server properties\n#Edited via mc-panel ${new Date().toISOString()}\n`;
    const out = body.startsWith('#') ? body : header + body;
    await conn.sftp.put(Readable.from(out), p);
    emit(EVENTS.ACTIVITY, { type: 'config.update', serverId, details: 'server.properties updated' });
    return { success: true, data: { ok: true } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}
