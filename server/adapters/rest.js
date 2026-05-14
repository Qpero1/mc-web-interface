/**
 * server/adapters/rest.js
 * --------------------------------------------------------------------------
 * Express adapter — thin wrappers that translate HTTP I/O into service
 * calls. No business logic lives here; validate inputs, dispatch to the
 * relevant service, return the structured result.
 * --------------------------------------------------------------------------
 */
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as lifecycle from '../services/serverLifecycle.js';
import * as rconService from '../services/rconService.js';
import * as fileService from '../services/fileService.js';
import * as modService from '../services/modService.js';
import * as worldService from '../services/worldService.js';
import * as configService from '../services/configService.js';
import * as playersService from '../services/playersService.js';
import { onAny } from '../events/emitter.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
const uploadMany = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 * 1024 * 1024 } });

/** Send a service result as JSON, mapping structured errors to HTTP status. */
function reply(res, result) {
  if (result.success) return res.json(result.data);
  const err = result.error || {};
  const map = { SERVER_NOT_FOUND: 404, BAD_INPUT: 400, PATH_TRAVERSAL: 400, WORLD_NOT_FOUND: 404, NO_LEVEL_DAT: 400 };
  const code = map[err.errorCode] || 500;
  return res.status(code).json({ error: err.message || 'Internal error', errorCode: err.errorCode });
}

/**
 * Mount the REST adapter onto a router. Returns the router.
 *
 * @param {object} deps
 * @param {object} deps.ctx Shared context { executor, registry, rconManager }
 * @param {import('../activityLog.js').ActivityLog} deps.activityLog
 * @param {object} deps.backupService
 * @param {object} deps.statsService
 */
export function registerRestAdapter({ ctx, activityLog, backupService, statsService }) {
  const router = express.Router();
  const { executor, registry } = ctx;

  // Bridge events → activity log
  onAny((event, payload) => {
    if (event === 'activity') {
      activityLog.record({
        type: payload.type, serverId: payload.serverId,
        serverName: payload.serverName || registry.get(payload.serverId)?.name,
        details: payload.details,
      });
    }
  });

  // ---- Identity & misc
  router.get('/me', (req, res) => res.json({ username: req.user?.username }));
  router.get('/activity', (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    res.json({ entries: activityLog.recent(limit) });
  });

  // ---- Servers CRUD
  router.get('/servers', (_req, res) => res.json({ servers: registry.publicList() }));
  router.post('/servers', async (req, res) => {
    try {
      const created = await registry.addServer(req.body);
      activityLog.record({ type: 'server.add', serverId: created.id, serverName: created.name, details: 'Server added' });
      res.json({ server: registry.publicView(created.id) });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  router.put('/servers/:id', async (req, res) => {
    try {
      const u = await registry.updateServer(req.params.id, req.body);
      activityLog.record({ type: 'server.update', serverId: u.id, serverName: u.name, details: 'Server updated' });
      res.json({ server: registry.publicView(u.id) });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });
  router.delete('/servers/:id', async (req, res) => {
    try {
      const r = await registry.removeServer(req.params.id);
      activityLog.record({ type: 'server.remove', serverId: r.id, serverName: r.name, details: 'Server removed' });
      res.json({ ok: true });
    } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
  });

  // ---- Lifecycle
  router.post('/servers/:id/lifecycle/:action', async (req, res) => {
    const result = await lifecycle.lifecycle(ctx, req.params.id, req.params.action);
    return reply(res, result);
  });

  // ---- Console (REST send; live stream via socket)
  router.post('/console/:id/send', async (req, res) => {
    const { command } = req.body || {};
    if (!command) return res.status(400).json({ error: 'command required' });
    const result = await rconService.send(ctx, req.params.id, command);
    return reply(res, result);
  });
  router.get('/console/:id/tail', (_req, res) => {
    // Backlog is served via socket; provide empty placeholder here.
    res.json({ lines: [] });
  });

  // ---- Files
  router.get('/files/:id/list', async (req, res) => reply(res, await fileService.list(ctx, req.params.id, req.query.path || '/')));
  router.get('/files/:id/download', async (req, res) => {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path required' });
    const conn = await executor.openSftp(req.params.id);
    try {
      const remote = require_path(conn.server, rel);
      const stat = await conn.sftp.stat(remote);
      if (stat.isDirectory) { res.status(400).json({ error: 'cannot download a directory' }); return; }
      const name = path.posix.basename(remote);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
      res.setHeader('Content-Length', String(stat.size));
      const stream = await conn.sftp.createReadStream(remote);
      stream.pipe(res);
      stream.on('end', () => { conn.sftp.end().catch(() => {}); });
      stream.on('error', (err) => res.destroy(err));
    } catch (err) {
      try { await conn.sftp.end(); } catch {}
      res.status(500).json({ error: err.message });
    }
  });
  router.post('/files/:id/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const conn = await executor.openSftp(req.params.id);
    try {
      const dir = require_path(conn.server, req.body.path || '/');
      const target = `${dir}/${req.file.originalname}`;
      await conn.sftp.put(Readable.from(req.file.buffer), target);
      activityLog.record({ type: 'files.upload', serverId: req.params.id, serverName: conn.server.name, details: `${req.file.originalname} → ${req.body.path || '/'}` });
      res.json({ ok: true, target });
    } catch (err) { res.status(500).json({ error: err.message }); }
    finally { try { await conn.sftp.end(); } catch {} }
  });
  router.post('/files/:id/mkdir', async (req, res) => reply(res, await fileService.mkdir(ctx, req.params.id, req.body?.path)));
  router.post('/files/:id/rename', async (req, res) => reply(res, await fileService.rename(ctx, req.params.id, req.body?.from, req.body?.to)));
  router.delete('/files/:id', async (req, res) => reply(res, await fileService.remove(ctx, req.params.id, req.query.path)));

  // ---- Mods
  router.get('/mods/:id', async (req, res) => reply(res, await modService.list(ctx, req.params.id)));
  router.post('/mods/:id/upload', uploadMany.array('files', 32), async (req, res) => reply(res, await modService.upload(ctx, req.params.id, req.files || [])));
  router.post('/mods/:id/toggle', async (req, res) => reply(res, await modService.toggle(ctx, req.params.id, req.body?.name, req.body?.enabled)));
  router.delete('/mods/:id', async (req, res) => reply(res, await modService.remove(ctx, req.params.id, req.query.name)));

  // ---- Worlds
  router.get('/worlds/:id', async (req, res) => reply(res, await worldService.list(ctx, req.params.id)));
  router.post('/worlds/:id/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'zip file required' });
    reply(res, await worldService.uploadZip(ctx, req.params.id, req.file.buffer));
  });
  router.post('/worlds/:id/active', async (req, res) => reply(res, await worldService.setActive(ctx, req.params.id, req.body?.name)));
  router.delete('/worlds/:id', async (req, res) => reply(res, await worldService.remove(ctx, req.params.id, req.query.name)));
  router.get('/worlds/:id/download', async (req, res) => {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
    const result = await worldService.downloadZip(ctx, req.params.id, name, res);
    if (!result.success && !res.headersSent) reply(res, result);
  });

  // ---- Players
  router.get('/players/:id', async (req, res) => reply(res, await playersService.roster(ctx, req.params.id)));
  router.post('/players/:id/whitelist', async (req, res) => reply(res, await playersService.rconService.setWhitelist(ctx, req.params.id, req.body?.name, req.body?.action)));
  router.post('/players/:id/ban', async (req, res) => reply(res, await playersService.rconService.ban(ctx, req.params.id, req.body || {})));
  router.post('/players/:id/kick', async (req, res) => reply(res, await playersService.rconService.kick(ctx, req.params.id, req.body?.name, req.body?.reason || '')));

  // ---- Backups
  router.get('/backups/:id', async (req, res) => reply(res, await backupService.listBackups(req.params.id)));
  router.post('/backups/:id/create', async (req, res) => reply(res, await backupService.createBackup(req.params.id, req.body?.world)));
  router.delete('/backups/:id', async (req, res) => reply(res, await backupService.deleteBackup(req.params.id, req.query.world, req.query.name)));
  router.post('/backups/:id/schedule', async (req, res) => reply(res, await backupService.setSchedule(req.params.id, req.body?.world, req.body?.interval)));
  router.get('/backups/:id/download', async (req, res) => {
    const { world, name } = req.query;
    if (!world || !name) return res.status(400).json({ error: 'world and name required' });
    const conn = await executor.openSftp(req.params.id);
    try {
      const root = conn.server.directory.replace(/\/$/, '');
      const target = `${root}/backups/${path.posix.basename(world)}/${path.posix.basename(name)}`;
      const stat = await conn.sftp.stat(target);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(stat.size));
      const stream = await conn.sftp.createReadStream(target);
      stream.pipe(res);
      stream.on('end', () => conn.sftp.end().catch(() => {}));
      stream.on('error', (err) => res.destroy(err));
    } catch (err) {
      try { await conn.sftp.end(); } catch {}
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Config
  router.get('/config/:id/properties', async (req, res) => reply(res, await configService.readProperties(ctx, req.params.id)));
  router.put('/config/:id/properties', async (req, res) => reply(res, await configService.writeProperties(ctx, req.params.id, req.body || {})));

  // ---- Stats
  router.get('/stats/:id', (req, res) => {
    const id = req.params.id;
    res.json({ latest: statsService.getLatest(id), history: statsService.getHistory(id), rcon: ctx.rconManager.status(id) });
  });
  router.get('/stats', (_req, res) => res.json(statsService.snapshot()));

  return router;

  // Local helper: path resolution that respects server root.
  function require_path(server, relative) {
    const root = server.directory.replace(/\/$/, '');
    const cleaned = path.posix.normalize('/' + String(relative || '').replace(/\\/g, '/').replace(/^\/+/, ''));
    if (cleaned.includes('..')) {
      const err = new Error('Invalid path'); err.status = 400; throw err;
    }
    return root + cleaned;
  }
}
