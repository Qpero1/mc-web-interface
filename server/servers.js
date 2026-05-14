/**
 * server/servers.js
 * --------------------------------------------------------------------------
 * Server registry. Loads servers.json, persists changes, and exposes
 * helpers for SFTP, SSH command execution, and lifecycle actions.
 *
 * `publicView` / `publicList` strip secrets (rcon password, ssh password,
 * private keys) before sending to the frontend.
 * --------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client as SshClient } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';

/**
 * Build a slugged id from a server name.
 * @param {string} name
 */
function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || crypto.randomBytes(4).toString('hex');
}

/**
 * In-memory registry of configured Minecraft servers, persisted to servers.json.
 */
export class ServerRegistry {
  /**
   * @param {object} config
   * @param {string} rootDir
   * @param {import('./activityLog.js').ActivityLog} activityLog
   */
  constructor(config, rootDir, activityLog) {
    this.config = config;
    this.rootDir = rootDir;
    this.activityLog = activityLog;
    this.servers = new Map();
    this.filePath = config.serversFile;
  }

  /** Load servers.json from disk. Tolerates missing file. */
  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = parsed.servers || [];
      for (const s of list) this.servers.set(s.id, s);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /** Persist to servers.json (atomic via tmp+rename). */
  async save() {
    const out = { servers: Array.from(this.servers.values()) };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(out, null, 2));
    await fs.rename(tmp, this.filePath);
  }

  /** @param {string} id */
  get(id) {
    return this.servers.get(id);
  }

  /** @param {string} id */
  require(id) {
    const s = this.servers.get(id);
    if (!s) {
      const err = new Error(`Server "${id}" not found`);
      err.status = 404;
      throw err;
    }
    return s;
  }

  /** All servers, secrets stripped, suitable for the API. */
  publicList() {
    return Array.from(this.servers.values()).map((s) => this._strip(s));
  }

  publicView(id) {
    const s = this.servers.get(id);
    if (!s) return null;
    return this._strip(s);
  }

  _strip(s) {
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      directory: s.directory,
      rcon: { port: s.rcon?.port },
      ssh: { port: s.ssh?.port, username: s.ssh?.username, hasKey: Boolean(s.ssh?.privateKeyPath), hasPassword: Boolean(s.ssh?.password) },
      startCommand: s.startCommand,
      stopCommand: s.stopCommand,
      restartCommand: s.restartCommand,
    };
  }

  /**
   * Add a new server.
   * @param {object} payload
   */
  async addServer(payload) {
    const id = payload.id || slugify(payload.name);
    if (this.servers.has(id)) {
      const err = new Error(`Server id "${id}" already exists`);
      err.status = 409;
      throw err;
    }
    const record = this._normalize({ ...payload, id });
    this.servers.set(id, record);
    await this.save();
    return record;
  }

  /**
   * Update an existing server (partial patch).
   */
  async updateServer(id, patch) {
    const existing = this.require(id);
    const merged = {
      ...existing,
      ...patch,
      id,
      rcon: { ...existing.rcon, ...(patch.rcon || {}) },
      ssh: { ...existing.ssh, ...(patch.ssh || {}) },
    };
    const next = this._normalize(merged);
    this.servers.set(id, next);
    await this.save();
    return next;
  }

  /** Remove a server entirely. */
  async removeServer(id) {
    const existing = this.require(id);
    this.servers.delete(id);
    await this.save();
    return existing;
  }

  _normalize(s) {
    if (!s.name) throw Object.assign(new Error('name is required'), { status: 400 });
    if (!s.host) throw Object.assign(new Error('host is required'), { status: 400 });
    if (!s.directory) throw Object.assign(new Error('directory is required'), { status: 400 });
    return {
      id: s.id,
      name: s.name,
      host: s.host,
      directory: s.directory,
      rcon: {
        port: parseInt(s.rcon?.port, 10) || 25575,
        password: s.rcon?.password || '',
      },
      ssh: {
        port: parseInt(s.ssh?.port, 10) || 22,
        username: s.ssh?.username || 'minecraft',
        password: s.ssh?.password || '',
        privateKeyPath: s.ssh?.privateKeyPath || '',
      },
      startCommand: s.startCommand || '',
      stopCommand: s.stopCommand || '',
      restartCommand: s.restartCommand || '',
    };
  }

  /**
   * Resolve SSH connect options. Reads the private key file if configured.
   * @param {object} server
   */
  async sshOptions(server) {
    const opts = {
      host: server.host,
      port: server.ssh.port,
      username: server.ssh.username,
      readyTimeout: 15000,
    };
    if (server.ssh.privateKeyPath) {
      opts.privateKey = await fs.readFile(server.ssh.privateKeyPath);
    } else if (server.ssh.password) {
      opts.password = server.ssh.password;
    }
    return opts;
  }

  /**
   * Open an SFTP connection. Caller is responsible for `.end()`.
   * @param {string} id
   */
  async sftp(id) {
    const server = this.require(id);
    const sftp = new SftpClient();
    await sftp.connect(await this.sshOptions(server));
    return { sftp, server };
  }

  /**
   * Run a shell command on the remote host. Returns { code, stdout, stderr }.
   * @param {string} id
   * @param {string} command
   */
  async runSsh(id, command) {
    const server = this.require(id);
    if (!command) throw Object.assign(new Error('No command provided'), { status: 400 });
    const opts = await this.sshOptions(server);
    return new Promise((resolve, reject) => {
      const conn = new SshClient();
      let stdout = '';
      let stderr = '';
      conn
        .on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }
            stream.on('close', (code) => {
              conn.end();
              resolve({ code: code ?? 0, stdout, stderr });
            });
            stream.on('data', (d) => { stdout += d.toString('utf8'); });
            stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
          });
        })
        .on('error', (err) => reject(err))
        .connect(opts);
    });
  }

  /**
   * Run a configured lifecycle action (start/stop/restart) over SSH.
   * @param {string} id
   * @param {'start'|'stop'|'restart'} action
   */
  async runLifecycle(id, action) {
    const server = this.require(id);
    const cmdMap = {
      start: server.startCommand,
      stop: server.stopCommand,
      restart: server.restartCommand,
    };
    const cmd = cmdMap[action];
    if (!cmd) {
      throw Object.assign(new Error(`No "${action}" command configured for this server`), { status: 400 });
    }
    return this.runSsh(id, cmd);
  }
}
