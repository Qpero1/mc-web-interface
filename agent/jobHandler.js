/**
 * agent/jobHandler.js
 * --------------------------------------------------------------------------
 * Local job dispatcher. Receives a job object and routes it to the right
 * subsystem (processManager / rcon / file ops / etc). Per-server jobs are
 * queued sequentially; jobs for different servers run concurrently.
 *
 * Every result is `{ jobId, success, data, error }`. Failures never crash
 * the agent — they return a structured error and full stacks go to logs.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';
import { getServer } from './config.js';

/**
 * Validate a relative path stays inside the server's directory.
 * @returns absolute resolved path
 */
function resolveInside(server, relative) {
  const root = path.resolve(server.directory);
  const candidate = path.resolve(root, String(relative || '').replace(/^\/+|^\\+/, ''));
  const rel = path.relative(root, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const e = new Error('Path escapes server root');
    e.code = 'PATH_TRAVERSAL'; throw e;
  }
  return candidate;
}

/**
 * Create a job handler bound to the agent's subsystems.
 * @param {object} deps
 */
export function createJobHandler(deps) {
  const { config, stateManager, processManager, logStreamer, rcon, agentConfig } = deps;

  /** Per-server FIFO queue so we never overlap start/stop on the same server. */
  const queues = new Map();
  function runOnServer(serverId, task) {
    const cur = queues.get(serverId) || Promise.resolve();
    const next = cur.catch(() => {}).then(task);
    queues.set(serverId, next.finally(() => {
      if (queues.get(serverId) === next) queues.delete(serverId);
    }));
    return next;
  }

  /** Build a structured error. */
  function fail(code, message, serverId, retryable = false) {
    return { success: false, error: { errorCode: code, message, serverId, retryable } };
  }
  function ok(data) { return { success: true, data }; }

  /** Catch any thrown error and convert to structured failure. */
  async function safe(serverId, action, fn) {
    try {
      return await fn();
    } catch (err) {
      logger.error('job.exception', { serverId, action, error: err });
      const code = err.code || 'UNKNOWN_ERROR';
      return fail(code, err.message || 'Internal error', serverId, code === 'TIMEOUT' || code === 'RCON_UNAVAILABLE');
    }
  }

  /** Locate a server by id; returns structured failure if missing. */
  function withServer(serverId, fn) {
    let server;
    try { server = getServer(config, serverId); }
    catch (err) { return fail(err.code || 'SERVER_NOT_FOUND', err.message, serverId, false); }
    return fn(server);
  }

  const jobs = {
    /** Start a server. */
    async startServer({ serverId }) {
      return safe(serverId, 'startServer', () => withServer(serverId, async (server) => {
        const state = stateManager.getState(serverId);
        if (state.process === 'starting' || state.process === 'online') {
          return fail('ALREADY_RUNNING', `Server '${serverId}' is already ${state.process}`, serverId, false);
        }
        stateManager.setState(serverId, { process: 'starting', rcon: 'connecting', startedAt: Date.now(), crash: null });
        try {
          const { pid } = await processManager.start(server);
          stateManager.setState(serverId, { pid });
        } catch (err) {
          stateManager.setState(serverId, { process: 'offline', pid: null });
          return fail(err.code || 'START_FAILED', err.message, serverId, true);
        }
        // Begin tailing this server's log
        logStreamer.subscribe(server, () => {})();
        // Begin RCON readiness polling (non-blocking)
        rcon.waitForReady(server, agentConfig.rconReadyTimeoutMs).then((ready) => {
          if (ready) stateManager.setState(serverId, { process: 'online', rcon: 'ready' });
        }).catch(() => {});
        return ok({ pid: stateManager.getState(serverId).pid });
      }));
    },

    /** Stop a server. */
    async stopServer({ serverId }) {
      return safe(serverId, 'stopServer', () => withServer(serverId, async (server) => {
        if (!processManager.isRunning(serverId)) {
          stateManager.setState(serverId, { process: 'offline', rcon: 'disconnected', pid: null });
          return fail('NOT_RUNNING', `Server '${serverId}' is not running`, serverId, false);
        }
        stateManager.setState(serverId, { process: 'stopping', rcon: 'disconnected' });
        rcon.forget(serverId);
        const result = await processManager.stop(server);
        stateManager.setState(serverId, { process: 'offline', pid: null });
        return ok({ code: result.code, signal: result.signal });
      }));
    },

    async restartServer({ serverId }) {
      return safe(serverId, 'restartServer', async () => {
        if (processManager.isRunning(serverId)) {
          const stop = await jobs.stopServer({ serverId });
          if (!stop.success) return stop;
        }
        return jobs.startServer({ serverId });
      });
    },

    async getServerStatus({ serverId }) {
      return safe(serverId, 'getServerStatus', () => withServer(serverId, async () => {
        const state = stateManager.getState(serverId);
        return ok({ ...state, rconReady: rcon.isReady(serverId), pidAlive: state.pid ? processManager.isPidAlive(state.pid) : false });
      }));
    },

    async fetchConsoleTail({ serverId }) {
      return safe(serverId, 'fetchConsoleTail', () => withServer(serverId, async () => {
        return ok({ lines: logStreamer.backlog(serverId) });
      }));
    },

    async getStats({ serverId }) {
      return safe(serverId, 'getStats', () => withServer(serverId, async (server) => {
        let players = 0; let online = false;
        if (rcon.isReady(serverId)) {
          try {
            const resp = await rcon.send(server, 'list');
            online = true;
            const m = resp.match(/(\d+)\s+of\s+a\s+max\s+of\s+(\d+)/i);
            if (m) players = parseInt(m[1], 10);
          } catch {}
        }
        const cpu = process.cpuUsage(); const mem = process.memoryUsage();
        return ok({ players, online, agentCpuUserMicros: cpu.user, agentRssBytes: mem.rss, ts: Date.now() });
      }));
    },

    async executeRcon({ serverId, command }) {
      return safe(serverId, 'executeRcon', () => withServer(serverId, async (server) => {
        if (!command || typeof command !== 'string') return fail('BAD_INPUT', 'command must be a non-empty string', serverId, false);
        const resp = await rcon.send(server, command.replace(/^\//, ''));
        return ok({ response: resp });
      }));
    },

    async listFiles({ serverId, path: rel = '/' }) {
      return safe(serverId, 'listFiles', () => withServer(serverId, async (server) => {
        const abs = resolveInside(server, rel);
        const dirents = await fs.readdir(abs, { withFileTypes: true });
        const entries = [];
        for (const d of dirents) {
          const full = path.join(abs, d.name);
          let stat;
          try { stat = await fs.stat(full); } catch { stat = { size: 0, mtimeMs: 0 }; }
          entries.push({
            name: d.name,
            type: d.isDirectory() ? 'directory' : d.isSymbolicLink() ? 'symlink' : 'file',
            size: stat.size, modifyTime: stat.mtimeMs,
          });
        }
        return ok({ path: rel, entries });
      }));
    },

    async readFile({ serverId, path: rel }) {
      return safe(serverId, 'readFile', () => withServer(serverId, async (server) => {
        const abs = resolveInside(server, rel);
        const buf = await fs.readFile(abs);
        return ok({ content: buf.toString('utf8') });
      }));
    },

    async writeFile({ serverId, path: rel, content }) {
      return safe(serverId, 'writeFile', () => withServer(serverId, async (server) => {
        const abs = resolveInside(server, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content ?? '');
        return ok({ bytes: Buffer.byteLength(content ?? '') });
      }));
    },

    async deleteFile({ serverId, path: rel }) {
      return safe(serverId, 'deleteFile', () => withServer(serverId, async (server) => {
        const abs = resolveInside(server, rel);
        await fs.rm(abs, { recursive: true, force: true });
        return ok({ ok: true });
      }));
    },

    async renameFile({ serverId, from, to }) {
      return safe(serverId, 'renameFile', () => withServer(serverId, async (server) => {
        const fromAbs = resolveInside(server, from);
        const toAbs = resolveInside(server, to);
        await fs.mkdir(path.dirname(toAbs), { recursive: true });
        await fs.rename(fromAbs, toAbs);
        return ok({ ok: true });
      }));
    },

    async updateConfig({ serverId, key, value }) {
      return safe(serverId, 'updateConfig', () => withServer(serverId, async (server) => {
        const propsPath = path.join(path.resolve(server.directory), 'server.properties');
        let txt = '';
        try { txt = await fs.readFile(propsPath, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
        const lines = txt.split(/\r?\n/);
        let found = false;
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i] || lines[i].startsWith('#')) continue;
          const idx = lines[i].indexOf('=');
          if (idx === -1) continue;
          if (lines[i].slice(0, idx).trim() === key) { lines[i] = `${key}=${value}`; found = true; break; }
        }
        if (!found) lines.push(`${key}=${value}`);
        await fs.writeFile(propsPath, lines.join('\n'));
        return ok({ ok: true });
      }));
    },

    async toggleMod({ serverId, modFilename, enabled }) {
      return safe(serverId, 'toggleMod', () => withServer(serverId, async (server) => {
        const modsDir = resolveInside(server, 'mods');
        const fromName = path.basename(modFilename);
        const from = path.join(modsDir, fromName);
        const isEnabled = /\.jar$/i.test(fromName);
        const next = (enabled === true || (enabled === undefined && !isEnabled))
          ? from.replace(/\.jar\.disabled$/i, '.jar')
          : from.replace(/\.jar$/i, '.jar.disabled');
        if (from === next) return ok({ unchanged: true });
        await fs.rename(from, next);
        return ok({ name: path.basename(next) });
      }));
    },

    async createBackup({ serverId, worldName }) {
      return safe(serverId, 'createBackup', () => withServer(serverId, async (server) => {
        const archiver = (await import('archiver')).default;
        const root = path.resolve(server.directory);
        const target = resolveInside(server, worldName || 'world');
        try { await fs.access(target); }
        catch { return fail('WORLD_NOT_FOUND', `World folder '${worldName}' not found`, serverId, false); }
        const backupsDir = path.resolve(agentConfig.backupDirectory || './backups', serverId);
        await fs.mkdir(backupsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join(backupsDir, `${path.basename(target)}-${ts}.zip`);
        const fsLib = await import('node:fs');
        const out = fsLib.createWriteStream(file);
        const archive = archiver('zip', { zlib: { level: 6 } });
        const done = new Promise((resolve, reject) => {
          out.on('close', resolve);
          archive.on('error', reject);
        });
        archive.pipe(out);
        archive.directory(target, path.basename(target));
        await archive.finalize();
        await done;
        return ok({ filename: path.basename(file), path: file });
      }));
    },

    async listBackups({ serverId }) {
      return safe(serverId, 'listBackups', () => withServer(serverId, async () => {
        const dir = path.resolve(agentConfig.backupDirectory || './backups', serverId);
        try { await fs.access(dir); } catch { return ok({ backups: [] }); }
        const files = await fs.readdir(dir);
        const stats = await Promise.all(files.filter((f) => f.endsWith('.zip')).map(async (f) => {
          const s = await fs.stat(path.join(dir, f));
          return { name: f, size: s.size, modifyTime: s.mtimeMs };
        }));
        stats.sort((a, b) => b.modifyTime - a.modifyTime);
        return ok({ backups: stats });
      }));
    },

    async deleteBackup({ serverId, backupName }) {
      return safe(serverId, 'deleteBackup', () => withServer(serverId, async () => {
        const dir = path.resolve(agentConfig.backupDirectory || './backups', serverId);
        const target = path.join(dir, path.basename(backupName));
        await fs.rm(target, { force: true });
        return ok({ ok: true });
      }));
    },
  };

  /**
   * Dispatch a job by type. Same-server jobs are queued; different servers run in parallel.
   * @param {{type:string, ...any}} job
   */
  async function dispatch(job) {
    const jobId = job.jobId || randomUUID();
    const type = job.type;
    const fn = jobs[type];
    if (!fn) {
      logger.warn('job.unknown', { jobId, type });
      return { jobId, success: false, error: { errorCode: 'UNKNOWN_JOB', message: `Unknown job type: ${type}`, serverId: job.serverId || null, retryable: false } };
    }
    logger.info('job.received', { jobId, type, serverId: job.serverId });
    const exec = async () => {
      logger.info('job.executing', { jobId, type, serverId: job.serverId });
      const result = await fn(job);
      const tag = result.success ? 'job.completed' : 'job.failed';
      logger[result.success ? 'info' : 'warn'](tag, { jobId, type, serverId: job.serverId, errorCode: result.error?.errorCode });
      return { jobId, ...result };
    };
    if (job.serverId) return runOnServer(job.serverId, exec);
    return exec();
  }

  return { dispatch, jobs };
}
