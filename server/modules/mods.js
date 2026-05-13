/**
 * server/modules/mods.js
 * --------------------------------------------------------------------------
 * Mod management — lists files inside <serverDir>/mods, supports upload,
 * delete, and toggling .jar ↔ .jar.disabled by rename.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import multer from 'multer';
import { Readable } from 'node:stream';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024 * 1024 } });

function modsDir(server) {
  return `${server.directory.replace(/\/$/, '')}/mods`;
}

/**
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerModsModule(ctx) {
  const { api, registry, activityLog } = ctx;

  api.get('/mods/:id', async (req, res, next) => {
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const dir = modsDir(conn.server);
      try { await sftp.stat(dir); } catch { await sftp.mkdir(dir, true); }
      const entries = await sftp.list(dir);
      const mods = entries
        .filter((e) => e.type === '-' && (/\.jar$/i.test(e.name) || /\.jar\.disabled$/i.test(e.name)))
        .map((e) => ({
          name: e.name,
          size: e.size,
          modifyTime: e.modifyTime,
          enabled: /\.jar$/i.test(e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ mods });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/mods/:id/upload', upload.array('files', 32), async (req, res, next) => {
    let sftp;
    try {
      if (!req.files || req.files.length === 0) throw Object.assign(new Error('files required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const dir = modsDir(conn.server);
      try { await sftp.stat(dir); } catch { await sftp.mkdir(dir, true); }
      const uploaded = [];
      for (const f of req.files) {
        const safeName = path.posix.basename(f.originalname);
        const target = `${dir}/${safeName}`;
        await sftp.put(Readable.from(f.buffer), target);
        uploaded.push(safeName);
      }
      activityLog.record({
        type: 'mods.upload', serverId: req.params.id, serverName: conn.server.name,
        details: uploaded.join(', '),
      });
      res.json({ ok: true, uploaded });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/mods/:id/toggle', async (req, res, next) => {
    let sftp;
    try {
      const { name, enabled } = req.body || {};
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const dir = modsDir(conn.server);
      const from = `${dir}/${path.posix.basename(name)}`;
      const isEnabled = /\.jar$/i.test(name);
      const next = enabled === true || (enabled === undefined && !isEnabled)
        ? from.replace(/\.jar\.disabled$/i, '.jar')
        : from.replace(/\.jar$/i, '.jar.disabled');
      if (from === next) return res.json({ ok: true, unchanged: true });
      await sftp.rename(from, next);
      activityLog.record({
        type: 'mods.toggle', serverId: req.params.id, serverName: conn.server.name,
        details: `${path.posix.basename(name)} → ${path.posix.basename(next)}`,
      });
      res.json({ ok: true, name: path.posix.basename(next) });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.delete('/mods/:id', async (req, res, next) => {
    let sftp;
    try {
      const { name } = req.query;
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const dir = modsDir(conn.server);
      const target = `${dir}/${path.posix.basename(name)}`;
      await sftp.delete(target);
      activityLog.record({
        type: 'mods.delete', serverId: req.params.id, serverName: conn.server.name, details: name,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });
}
