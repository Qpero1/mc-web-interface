/**
 * server/services/backupService.js
 * --------------------------------------------------------------------------
 * World backups: list, create (remote zip via SSH), delete, download,
 * plus cron-based auto-schedule management.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import cron from 'node-cron';
import { emit, EVENTS } from '../events/emitter.js';

const INTERVAL_TO_CRON = {
  '1h': '0 * * * *', '3h': '0 */3 * * *', '6h': '0 */6 * * *',
  '12h': '0 */12 * * *', '24h': '0 3 * * *',
};

function shellEscape(p) { return `'${String(p).replace(/'/g, `'\\''`)}'`; }

export function createBackupService(ctx, { schedulesFile }) {
  const { executor, registry } = ctx;
  const jobs = new Map();
  let schedules = new Map();

  async function loadSchedules() {
    try {
      const t = await fs.readFile(schedulesFile, 'utf8');
      schedules = new Map(Object.entries(JSON.parse(t)));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[backups] schedule read failed:', err.message);
      schedules = new Map();
    }
  }
  async function saveSchedules() {
    await fs.mkdir(path.dirname(schedulesFile), { recursive: true });
    const tmp = schedulesFile + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(schedules), null, 2));
    await fs.rename(tmp, schedulesFile);
  }

  function key(serverId, world) { return `${serverId}::${world}`; }

  async function createBackup(serverId, world) {
    const server = registry.require(serverId);
    const root = server.directory.replace(/\/$/, '');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeWorld = String(world).replace(/[^A-Za-z0-9_.-]/g, '_');
    const filename = `${safeWorld}-${ts}.zip`;
    const dir = `${root}/backups/${safeWorld}`;
    const target = `${dir}/${filename}`;
    const cmd = `mkdir -p ${shellEscape(dir)} && cd ${shellEscape(root)} && zip -r ${shellEscape(target)} ${shellEscape(safeWorld)} > /dev/null`;
    const res = await executor.runShell(serverId, cmd);
    if (!res.success) {
      emit(EVENTS.BACKUP_FAILED, { serverId, world: safeWorld, error: res.error });
      return res;
    }
    if (res.data.code !== 0) {
      emit(EVENTS.BACKUP_FAILED, { serverId, world: safeWorld, exitCode: res.data.code });
      return { success: false, error: { errorCode: 'BACKUP_FAILED', message: `Backup zip failed (exit ${res.data.code})`, serverId, retryable: true } };
    }
    emit(EVENTS.BACKUP_CREATED, { serverId, world: safeWorld, filename });
    emit(EVENTS.ACTIVITY, { type: 'backups.create', serverId, details: filename });
    return { success: true, data: { filename, world: safeWorld } };
  }

  function startJob(serverId, world, interval) {
    const k = key(serverId, world);
    jobs.get(k)?.stop();
    const expr = INTERVAL_TO_CRON[interval];
    if (!expr) return;
    jobs.set(k, cron.schedule(expr, () => {
      createBackup(serverId, world).catch(() => {});
    }));
  }
  function stopJob(serverId, world) {
    const k = key(serverId, world);
    jobs.get(k)?.stop(); jobs.delete(k);
  }

  async function listBackups(serverId) {
    const conn = await executor.openSftp(serverId);
    try {
      const root = conn.server.directory.replace(/\/$/, '');
      const br = `${root}/backups`;
      try { await conn.sftp.stat(br); } catch { await conn.sftp.mkdir(br, true); }
      const folders = await conn.sftp.list(br);
      const result = {};
      for (const wf of folders) {
        if (wf.type !== 'd') continue;
        const entries = await conn.sftp.list(`${br}/${wf.name}`);
        result[wf.name] = entries
          .filter((e) => e.type === '-' && e.name.endsWith('.zip'))
          .map((e) => ({ name: e.name, size: e.size, modifyTime: e.modifyTime }))
          .sort((a, b) => b.modifyTime - a.modifyTime);
      }
      const sch = {};
      for (const [k, v] of schedules.entries()) if (v.serverId === serverId) sch[v.world] = v.interval;
      return { success: true, data: { backups: result, schedules: sch } };
    } catch (err) {
      return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
    } finally { await conn.sftp.end().catch(() => {}); }
  }

  async function deleteBackup(serverId, world, name) {
    const conn = await executor.openSftp(serverId);
    try {
      const root = conn.server.directory.replace(/\/$/, '');
      const t = `${root}/backups/${path.posix.basename(world)}/${path.posix.basename(name)}`;
      await conn.sftp.delete(t);
      emit(EVENTS.ACTIVITY, { type: 'backups.delete', serverId, details: `${world}/${name}` });
      return { success: true, data: { ok: true } };
    } catch (err) {
      return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
    } finally { await conn.sftp.end().catch(() => {}); }
  }

  async function setSchedule(serverId, world, interval) {
    const k = key(serverId, world);
    if (!interval || interval === 'off') { schedules.delete(k); stopJob(serverId, world); }
    else if (!INTERVAL_TO_CRON[interval]) {
      return { success: false, error: { errorCode: 'BAD_INPUT', message: 'interval must be 1h/3h/6h/12h/24h/off', serverId, retryable: false } };
    } else { schedules.set(k, { serverId, world, interval }); startJob(serverId, world, interval); }
    await saveSchedules();
    emit(EVENTS.ACTIVITY, { type: 'backups.schedule', serverId, details: `${world}: ${interval || 'off'}` });
    return { success: true, data: { ok: true } };
  }

  return {
    async init() {
      await loadSchedules();
      for (const v of schedules.values()) startJob(v.serverId, v.world, v.interval);
    },
    createBackup, listBackups, deleteBackup, setSchedule,
  };
}
