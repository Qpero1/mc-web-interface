/**
 * server/modules/config-editor.js
 * --------------------------------------------------------------------------
 * server.properties parser/writer. Parses the file into ordered entries
 * (key, value, comment lines preserved) so the frontend can render a
 * labeled form, and writes back preserving the original line order.
 *
 * Also exposes a raw read/write endpoint for advanced users.
 * --------------------------------------------------------------------------
 */
import { Readable } from 'node:stream';

/**
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerConfigEditorModule(ctx) {
  const { api, registry, activityLog } = ctx;

  api.get('/config/:id/properties', async (req, res, next) => {
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const path = `${root}/server.properties`;
      const exists = await sftp.exists(path);
      const text = exists ? (await sftp.get(path)).toString('utf8') : '';
      res.json({ raw: text, entries: parseProperties(text) });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.put('/config/:id/properties', async (req, res, next) => {
    let sftp;
    try {
      const { entries, raw } = req.body || {};
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const path = `${root}/server.properties`;
      let textToWrite;
      if (typeof raw === 'string') {
        textToWrite = raw;
      } else if (Array.isArray(entries)) {
        textToWrite = serializeProperties(entries);
      } else {
        throw Object.assign(new Error('Provide raw or entries'), { status: 400 });
      }
      // Prepend a header note
      const header = `#Minecraft server properties\n#Edited via mc-panel ${new Date().toISOString()}\n`;
      const out = textToWrite.startsWith('#') ? textToWrite : header + textToWrite;
      await sftp.put(Readable.from(out), path);
      activityLog.record({
        type: 'config.update', serverId: req.params.id, serverName: conn.server.name,
        details: 'server.properties updated',
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });
}

/**
 * Parse server.properties text into ordered entries. Comments and blanks are
 * preserved so the UI can choose to display them or not.
 *
 * @param {string} text
 * @returns {Array<{kind:'pair'|'comment'|'blank', key?:string, value?:string, text?:string}>}
 */
export function parseProperties(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (line === '') { out.push({ kind: 'blank' }); continue; }
    if (line.startsWith('#')) { out.push({ kind: 'comment', text: line.slice(1).trim() }); continue; }
    const idx = line.indexOf('=');
    if (idx === -1) { out.push({ kind: 'comment', text: line }); continue; }
    out.push({ kind: 'pair', key: line.slice(0, idx).trim(), value: line.slice(idx + 1) });
  }
  return out;
}

/**
 * @param {Array<{kind:string, key?:string, value?:string, text?:string}>} entries
 * @returns {string}
 */
export function serializeProperties(entries) {
  const lines = entries.map((e) => {
    if (e.kind === 'pair') return `${e.key}=${e.value ?? ''}`;
    if (e.kind === 'comment') return `#${e.text || ''}`;
    return '';
  });
  return lines.join('\n');
}
