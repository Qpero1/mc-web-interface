/**
 * server/modules/files.js
 * --------------------------------------------------------------------------
 * SFTP file browser: list, upload, download, delete, rename, mkdir.
 * All paths are resolved against the server's configured root directory and
 * are validated to prevent escapes (no `..` traversal outside the root).
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import multer from 'multer';
import { Readable } from 'node:stream';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

/**
 * Resolve a user-supplied relative path against the server root and make
 * sure it stays inside the root. Returns the absolute POSIX path.
 */
function resolveRemote(server, relative) {
  const root = server.directory.replace(/\/$/, '');
  const safe = path.posix.normalize('/' + (relative || '').replace(/\\/g, '/').replace(/^\/+/, ''));
  if (safe.includes('..')) {
    throw Object.assign(new Error('Invalid path'), { status: 400 });
  }
  return root + safe;
}

/**
 * Wire the files module into the router.
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerFilesModule(ctx) {
  const { api, registry, activityLog } = ctx;

  api.get('/files/:id/list', async (req, res, next) => {
    const rel = req.query.path || '/';
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const remote = resolveRemote(conn.server, rel);
      const entries = await sftp.list(remote);
      res.json({
        path: rel,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.type === 'd' ? 'directory' : e.type === 'l' ? 'symlink' : 'file',
          size: e.size,
          modifyTime: e.modifyTime,
          rights: e.rights,
        })),
      });
    } catch (err) {
      next(err);
    } finally {
      try { await sftp?.end(); } catch (_e) { /* ignore */ }
    }
  });

  api.get('/files/:id/download', async (req, res, next) => {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const remote = resolveRemote(conn.server, rel);
      const stat = await sftp.stat(remote);
      if (stat.isDirectory) return res.status(400).json({ error: 'cannot download a directory' });
      const name = path.posix.basename(remote);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
      res.setHeader('Content-Length', String(stat.size));
      const stream = await sftp.createReadStream(remote);
      stream.on('error', (err) => next(err));
      stream.pipe(res);
      stream.on('end', () => { sftp?.end().catch(() => {}); });
    } catch (err) {
      try { await sftp?.end(); } catch (_e) { /* ignore */ }
      next(err);
    }
  });

  api.post('/files/:id/upload', upload.single('file'), async (req, res, next) => {
    const rel = req.body.path || '/';
    let sftp;
    try {
      if (!req.file) throw Object.assign(new Error('file required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const remoteDir = resolveRemote(conn.server, rel);
      const target = path.posix.join(remoteDir, req.file.originalname);
      await sftp.put(Readable.from(req.file.buffer), target);
      activityLog.record({
        type: 'files.upload',
        serverId: req.params.id,
        serverName: conn.server.name,
        details: `${req.file.originalname} → ${rel}`,
      });
      res.json({ ok: true, target });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/files/:id/mkdir', async (req, res, next) => {
    const { path: rel } = req.body || {};
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const remote = resolveRemote(conn.server, rel);
      await sftp.mkdir(remote, true);
      activityLog.record({
        type: 'files.mkdir', serverId: req.params.id, serverName: conn.server.name, details: rel,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/files/:id/rename', async (req, res, next) => {
    const { from, to } = req.body || {};
    let sftp;
    try {
      if (!from || !to) throw Object.assign(new Error('from and to required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const fromAbs = resolveRemote(conn.server, from);
      const toAbs = resolveRemote(conn.server, to);
      await sftp.rename(fromAbs, toAbs);
      activityLog.record({
        type: 'files.rename', serverId: req.params.id, serverName: conn.server.name, details: `${from} → ${to}`,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.delete('/files/:id', async (req, res, next) => {
    const rel = req.query.path;
    let sftp;
    try {
      if (!rel) throw Object.assign(new Error('path required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const remote = resolveRemote(conn.server, rel);
      const stat = await sftp.stat(remote);
      if (stat.isDirectory) {
        await sftp.rmdir(remote, true);
      } else {
        await sftp.delete(remote);
      }
      activityLog.record({
        type: 'files.delete', serverId: req.params.id, serverName: conn.server.name, details: rel,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });
}
