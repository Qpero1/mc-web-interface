/**
 * server/execution/localExecutor.js
 * --------------------------------------------------------------------------
 * The single interface for all machine-level operations triggered by the
 * panel — files, RCON, SSH lifecycle, log tail.
 *
 * In the SFTP/SSH-backed deployment (current panel), operations are
 * fulfilled by the server registry's SSH client. In an agent-backed
 * deployment (future cloud-routed setup) the same calls would be
 * dispatched to a remote agent. Services and adapters never touch the
 * filesystem, RCON, or chokidar directly — only through here.
 *
 * Every function returns a structured result:
 *   success:true → { success:true, data:<...> }
 *   success:false → { success:false, error:{ errorCode, message, serverId, retryable } }
 * Raw stack traces are never returned; they are logged internally.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import { Readable } from 'node:stream';

const ROOT_MARKER = '/';

/** Build a successful result. @template T @param {T} data */
export function ok(data) { return { success: true, data }; }

/**
 * Build a structured error result.
 * @param {string} errorCode
 * @param {string} message
 * @param {string} [serverId]
 * @param {boolean} [retryable=false]
 */
export function fail(errorCode, message, serverId = null, retryable = false) {
  return { success: false, error: { errorCode, message, serverId, retryable } };
}

/** Internal helper: log a stack trace without exposing it to callers. */
function internalLog(serverId, op, err) {
  // eslint-disable-next-line no-console
  console.error(`[localExecutor] ${op} failed for ${serverId || 'n/a'}:`, err?.stack || err);
}

/**
 * Resolve and validate a server-relative path. Disallows traversal out of
 * the server's configured root directory.
 * @param {object} server Server config from registry
 * @param {string} relative User-supplied relative path
 */
export function resolveRemotePath(server, relative) {
  if (!server || !server.directory) {
    throw Object.assign(new Error('Server has no directory configured'), { code: 'BAD_SERVER_DIRECTORY' });
  }
  const root = server.directory.replace(/\/$/, '');
  const cleaned = String(relative || '').replace(/\\/g, '/');
  const normalized = path.posix.normalize(ROOT_MARKER + cleaned.replace(/^\/+/, ''));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw Object.assign(new Error('Path escapes server root'), { code: 'PATH_TRAVERSAL' });
  }
  return root + normalized;
}

/**
 * Create a localExecutor bound to a server registry and RCON manager.
 * The returned object exposes the Phase-2 contract used by services.
 *
 * @param {object} deps
 * @param {import('../servers.js').ServerRegistry} deps.registry
 * @param {import('../rcon.js').RconManager} deps.rconManager
 */
export function createLocalExecutor({ registry, rconManager }) {
  /** Internal: load and validate the server entry. */
  function requireServer(serverId) {
    const s = registry.get(serverId);
    if (!s) {
      const err = new Error(`Server "${serverId}" not found`);
      err.code = 'SERVER_NOT_FOUND';
      throw err;
    }
    return s;
  }

  /** Wrap an async fn with structured-error semantics. */
  async function wrap(serverId, op, fn) {
    try {
      const data = await fn();
      return ok(data);
    } catch (err) {
      internalLog(serverId, op, err);
      const code = err.code || err.errorCode || 'UNKNOWN_ERROR';
      const retryable = code === 'TIMEOUT' || code === 'RCON_UNAVAILABLE' || code === 'CONNECT_FAILED';
      return fail(code, sanitize(err.message), serverId, retryable);
    }
  }

  return {
    requireServer,
    wrap,
    ok,
    fail,

    /** Lifecycle: run the server's configured start command over SSH. */
    async startServer(serverId) {
      return wrap(serverId, 'startServer', async () => {
        requireServer(serverId);
        return registry.runLifecycle(serverId, 'start');
      });
    },
    async stopServer(serverId) {
      return wrap(serverId, 'stopServer', async () => {
        requireServer(serverId);
        return registry.runLifecycle(serverId, 'stop');
      });
    },
    async restartServer(serverId) {
      return wrap(serverId, 'restartServer', async () => {
        requireServer(serverId);
        return registry.runLifecycle(serverId, 'restart');
      });
    },

    /** Status: probe RCON to determine online/offline. */
    async getServerStatus(serverId) {
      return wrap(serverId, 'getServerStatus', async () => {
        requireServer(serverId);
        const reachable = await rconManager.probe(serverId);
        const health = rconManager.status(serverId);
        return { reachable, rcon: health };
      });
    },

    /** RCON. */
    async executeRcon(serverId, command) {
      return wrap(serverId, 'executeRcon', async () => {
        requireServer(serverId);
        if (!command || typeof command !== 'string') {
          const e = new Error('Command must be a non-empty string'); e.code = 'BAD_INPUT'; throw e;
        }
        const response = await rconManager.send(serverId, command.replace(/^\//, ''));
        return { response };
      });
    },

    /** Files. */
    async listDirectory(serverId, relative = '/') {
      return wrap(serverId, 'listDirectory', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const remote = resolveRemotePath(conn.server, relative);
          const entries = await conn.sftp.list(remote);
          return {
            path: relative,
            entries: entries.map((e) => ({
              name: e.name,
              type: e.type === 'd' ? 'directory' : e.type === 'l' ? 'symlink' : 'file',
              size: e.size,
              modifyTime: e.modifyTime,
              rights: e.rights,
            })),
          };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    async readFile(serverId, relative) {
      return wrap(serverId, 'readFile', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const remote = resolveRemotePath(conn.server, relative);
          const buf = await conn.sftp.get(remote);
          return { content: Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf) };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    async writeFile(serverId, relative, content) {
      return wrap(serverId, 'writeFile', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const remote = resolveRemotePath(conn.server, relative);
          const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
          await conn.sftp.put(Readable.from(body), remote);
          return { bytes: body.length };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    async deleteFile(serverId, relative) {
      return wrap(serverId, 'deleteFile', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const remote = resolveRemotePath(conn.server, relative);
          const stat = await conn.sftp.stat(remote);
          if (stat.isDirectory) await conn.sftp.rmdir(remote, true);
          else await conn.sftp.delete(remote);
          return { ok: true };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    async renameFile(serverId, fromRel, toRel) {
      return wrap(serverId, 'renameFile', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const from = resolveRemotePath(conn.server, fromRel);
          const to = resolveRemotePath(conn.server, toRel);
          await conn.sftp.rename(from, to);
          return { ok: true };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    async mkdir(serverId, relative) {
      return wrap(serverId, 'mkdir', async () => {
        const conn = await registry.sftp(serverId);
        try {
          const remote = resolveRemotePath(conn.server, relative);
          await conn.sftp.mkdir(remote, true);
          return { ok: true };
        } finally { await conn.sftp.end().catch(() => {}); }
      });
    },

    /** Open an SFTP session; caller is responsible for closing via .end(). */
    async openSftp(serverId) {
      requireServer(serverId);
      return registry.sftp(serverId);
    },

    /** Run an arbitrary remote shell command (used by backups, stats, etc). */
    async runShell(serverId, command) {
      return wrap(serverId, 'runShell', async () => {
        requireServer(serverId);
        return registry.runSsh(serverId, command);
      });
    },
  };
}

function sanitize(msg) {
  if (!msg) return 'Unknown error';
  // Strip any obvious password leaks
  return String(msg).replace(/password['"=:\s]+[^\s"',}]+/gi, 'password=***');
}
