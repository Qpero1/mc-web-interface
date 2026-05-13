/**
 * server/modules/backups.js
 * --------------------------------------------------------------------------
 * Per-world backups. Backups are zip files stored on the remote server in
 * <serverDir>/backups/<worldName>/<world>-<timestamp>.zip and are created
 * by remotely tarring + zipping via SSH.
 *
 * Also manages an auto-backup schedule per (server, world) persisted to
 * config.backups.schedulesFile, running via node-cron.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import cron from 'node-cron';

const INTERVAL_TO_CRON = {
  '1h': '0 * * * *',
  '3h': '0 */3 * * *',
  '6h': '0 */6 * * *',
  '12h': '0 */12 * * *',
  '24h': '0 3 * * *',
};

/**
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, activityLog:import('../activityLog.js').ActivityLog, rootDir:string}} ctx
 */
export function registerBackupsModule(ctx) {
  const { api, registry, activityLog } = ctx;
  const schedulesFile = registry.config.backups.schedulesFile;

  /** @type {Map<string, import('node-cron').ScheduledTask>} */
  const jobs = new Map();
  /** @type {Map<string, {serverId:string, world:string, interval:string}>} */
  let schedules = new Map();

  /** Read schedules from disk into memory. */
  async function loadSchedules() {
    try {
      const text = await fs.readFile(schedulesFile, 'utf8');
      const parsed = JSON.parse(text);
      schedules = new Map(Object.entries(parsed));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // eslint-disable-next-line no-console
        console.warn('[backups] schedules read failed:', err.message);
      }
      schedules = new Map();
    }
  }

  async function saveSchedules() {
    await fs.mkdir(path.dirname(schedulesFile), { recursive: true });
    const obj = Object.fromEntries(schedules.entries());
    const tmp = schedulesFile + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fs.rename(tmp, schedulesFile);
  }

  function jobKey(serverId, world) { return `${serverId}::${world}`; }

  function startJob(serverId, world, interval) {
    const key = jobKey(serverId, world);
    const existing = jobs.get(key);
    if (existing) existing.stop();
    const expr = INTERVAL_TO_CRON[interval];
    if (!expr) return;
    const task = cron.schedule(expr, async () => {
      try {
        await createBackup(registry, serverId, world);
        activityLog.record({
          type: 'backups.auto', serverId, serverName: registry.get(serverId)?.name,
          details: `Auto-backup of ${world}`,
        });
      } catch (err) {
        activityLog.record({
          type: 'backups.auto.failed', serverId, serverName: registry.get(serverId)?.name,
          details: err.message,
        });
      }
    });
    jobs.set(key, task);
  }

  function stopJob(serverId, world) {
    const key = jobKey(serverId, world);
    const job = jobs.get(key);
    if (job) {
      job.stop();
      jobs.delete(key);
    }
  }

  loadSchedules().then(() => {
    for (const [key, val] of schedules.entries()) {
      startJob(val.serverId, val.world, val.interval);
    }
  });

  // List backups for a server, grouped by world
  api.get('/backups/:id', async (req, res, next) => {
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const backupsRoot = `${root}/backups`;
      try { await sftp.stat(backupsRoot); } catch { await sftp.mkdir(backupsRoot, true); }
      const worldFolders = await sftp.list(backupsRoot);
      const result = {};
      for (const wf of worldFolders) {
        if (wf.type !== 'd') continue;
        const entries = await sftp.list(`${backupsRoot}/${wf.name}`);
        result[wf.name] = entries
          .filter((e) => e.type === '-' && e.name.endsWith('.zip'))
          .map((e) => ({ name: e.name, size: e.size, modifyTime: e.modifyTime }))
          .sort((a, b) => b.modifyTime - a.modifyTime);
      }
      // Include schedules
      const schedulesForServer = {};
      for (const [key, val] of schedules.entries()) {
        if (val.serverId === req.params.id) schedulesForServer[val.world] = val.interval;
      }
      res.json({ backups: result, schedules: schedulesForServer });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  // Create a backup
  api.post('/backups/:id/create', async (req, res, next) => {
    try {
      const { world } = req.body || {};
      if (!world) throw Object.assign(new Error('world required'), { status: 400 });
      const result = await createBackup(registry, req.params.id, world);
      activityLog.record({
        type: 'backups.create', serverId: req.params.id, serverName: registry.get(req.params.id)?.name,
        details: result.filename,
      });
      res.json(result);
    } catch (err) { next(err); }
  });

  // Delete a backup
  api.delete('/backups/:id', async (req, res, next) => {
    let sftp;
    try {
      const { world, name } = req.query;
      if (!world || !name) throw Object.assign(new Error('world and name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const target = `${root}/backups/${path.posix.basename(world)}/${path.posix.basename(name)}`;
      await sftp.delete(target);
      activityLog.record({
        type: 'backups.delete', serverId: req.params.id, serverName: conn.server.name,
        details: `${world}/${name}`,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  // Download a backup
  api.get('/backups/:id/download', async (req, res, next) => {
    let sftp;
    try {
      const { world, name } = req.query;
      if (!world || !name) throw Object.assign(new Error('world and name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const target = `${root}/backups/${path.posix.basename(world)}/${path.posix.basename(name)}`;
      const stat = await sftp.stat(target);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Length', String(stat.size));
      const stream = await sftp.createReadStream(target);
      stream.on('error', (err) => next(err));
      stream.on('end', () => { sftp?.end().catch(() => {}); });
      stream.pipe(res);
    } catch (err) {
      try { await sftp?.end(); } catch (_e) { /* ignore */ }
      next(err);
    }
  });

  // Update schedule (interval='off' to disable)
  api.post('/backups/:id/schedule', async (req, res, next) => {
    try {
      const { world, interval } = req.body || {};
      if (!world) throw Object.assign(new Error('world required'), { status: 400 });
      const key = jobKey(req.params.id, world);
      if (!interval || interval === 'off') {
        schedules.delete(key);
        stopJob(req.params.id, world);
      } else if (!INTERVAL_TO_CRON[interval]) {
        throw Object.assign(new Error('interval must be one of 1h/3h/6h/12h/24h/off'), { status: 400 });
      } else {
        schedules.set(key, { serverId: req.params.id, world, interval });
        startJob(req.params.id, world, interval);
      }
      await saveSchedules();
      activityLog.record({
        type: 'backups.schedule', serverId: req.params.id, serverName: registry.get(req.params.id)?.name,
        details: `${world}: ${interval || 'off'}`,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
}

/**
 * Create a backup by zipping the world directory on the remote host via SSH.
 * @param {import('../servers.js').ServerRegistry} registry
 * @param {string} serverId
 * @param {string} world
 */
async function createBackup(registry, serverId, world) {
  const server = registry.require(serverId);
  const root = server.directory.replace(/\/$/, '');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeWorld = world.replace(/[^A-Za-z0-9_.-]/g, '_');
  const filename = `${safeWorld}-${ts}.zip`;
  const remoteBackupsDir = `${root}/backups/${safeWorld}`;
  const target = `${remoteBackupsDir}/${filename}`;
  // Ensure backup dir exists, then zip from the server root (so paths inside zip start with worldName/)
  const mkdir = `mkdir -p ${shellEscape(remoteBackupsDir)}`;
  const zipCmd = `cd ${shellEscape(root)} && zip -r ${shellEscape(target)} ${shellEscape(safeWorld)} > /dev/null`;
  const result = await registry.runSsh(serverId, `${mkdir} && ${zipCmd}`);
  if (result.code !== 0) {
    const err = new Error(`Backup failed (exit ${result.code}): ${result.stderr || result.stdout}`);
    err.status = 500;
    throw err;
  }
  return { ok: true, filename, world: safeWorld };
}

function shellEscape(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}
