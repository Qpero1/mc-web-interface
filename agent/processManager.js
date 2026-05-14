/**
 * agent/processManager.js
 * --------------------------------------------------------------------------
 * Spawn, track, and stop Minecraft server child processes.
 *
 * - Spawn the configured start command via shell:true so quoting works
 *   correctly on Windows ("C:\\Program Files\\..."), Linux, and macOS.
 * - Track PIDs in-memory and report exits.
 * - Refuse duplicate starts.
 * - Port availability check before starting.
 * - Graceful stop (`stop` via stdin → SIGTERM → SIGKILL) with grace period.
 * --------------------------------------------------------------------------
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { logger } from './logger.js';

const RECENT_LOG_LINES = 50;

/** Check whether a TCP port is already bound on localhost. */
export function isPortInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => tester.close(() => resolve(false)))
      .listen(port, host);
  });
}

export class ProcessManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string,{proc:import('child_process').ChildProcess, startedAt:number, recentLog:string[], stopping:boolean}>} */
    this.procs = new Map();
  }

  isRunning(serverId) {
    const entry = this.procs.get(serverId);
    if (!entry) return false;
    return !!entry.proc && entry.proc.exitCode === null && !entry.proc.killed;
  }

  getPid(serverId) {
    const entry = this.procs.get(serverId);
    return entry?.proc?.pid || null;
  }

  addLogLine(serverId, line) {
    const entry = this.procs.get(serverId);
    if (!entry) return;
    entry.recentLog.push(line);
    if (entry.recentLog.length > RECENT_LOG_LINES) entry.recentLog.shift();
  }

  /**
   * Spawn a new server process.
   * @param {object} server agent server config
   * @returns {Promise<{pid:number}>}
   */
  async start(server) {
    if (this.isRunning(server.id)) {
      const e = new Error(`Server '${server.id}' already has a running process (PID ${this.getPid(server.id)})`);
      e.code = 'ALREADY_RUNNING'; throw e;
    }
    if (server.port && await isPortInUse(server.port)) {
      const e = new Error(`Port ${server.port} already in use on this host`);
      e.code = 'PORT_IN_USE'; throw e;
    }
    const cwd = path.resolve(server.directory);
    logger.info('process.spawn', { serverId: server.id, cwd, command: server.startCommand });
    // shell:true lets the OS handle quoting. On Windows this becomes
    // `cmd /d /s /c "<command>"` which correctly preserves the inner quotes.
    // On POSIX it becomes `/bin/sh -c "<command>"`.
    const proc = spawn(server.startCommand, {
      cwd,
      env: { ...process.env, MC_PANEL_SERVER_ID: server.id },
      windowsHide: true,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const entry = { proc, startedAt: Date.now(), recentLog: [], stopping: false };
    this.procs.set(server.id, entry);

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    let stdoutBuf = '';
    proc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      const parts = stdoutBuf.split(/\r?\n/);
      stdoutBuf = parts.pop();
      for (const line of parts) {
        if (line) { this.addLogLine(server.id, line); this.emit('log', { serverId: server.id, source: 'stdout', line }); }
      }
    });
    let stderrBuf = '';
    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk;
      const parts = stderrBuf.split(/\r?\n/);
      stderrBuf = parts.pop();
      for (const line of parts) {
        if (line) { this.addLogLine(server.id, line); this.emit('log', { serverId: server.id, source: 'stderr', line }); }
      }
    });

    proc.on('error', (err) => {
      logger.error('process.error', { serverId: server.id, error: err });
      this.emit('error', { serverId: server.id, error: err });
    });
    proc.on('exit', (code, signal) => {
      logger.info('process.exit', { serverId: server.id, code, signal, stopping: entry.stopping });
      this.procs.delete(server.id);
      if (entry.stopping) this.emit('stopped', { serverId: server.id, code, signal });
      else this.emit('crashed', { serverId: server.id, code, signal, recentLog: entry.recentLog.slice() });
    });

    return { pid: proc.pid };
  }

  /** Graceful stop. */
  async stop(server) {
    const entry = this.procs.get(server.id);
    if (!entry) {
      const e = new Error(`Server '${server.id}' is not running`);
      e.code = 'NOT_RUNNING'; throw e;
    }
    entry.stopping = true;
    const grace = server.stopGraceMs || 30000;
    return new Promise((resolve) => {
      const onExit = (code, signal) => { cleanup(); resolve({ code, signal }); };
      const cleanup = () => { clearTimeout(termTimer); clearTimeout(killTimer); entry.proc.off('exit', onExit); };
      entry.proc.once('exit', onExit);
      try { entry.proc.stdin?.write('stop\n'); } catch {}
      const termTimer = setTimeout(() => {
        if (entry.proc.exitCode !== null) return;
        try { entry.proc.kill('SIGTERM'); } catch {}
      }, Math.max(1000, grace / 2));
      const killTimer = setTimeout(() => {
        if (entry.proc.exitCode !== null) return;
        try { entry.proc.kill('SIGKILL'); } catch {}
      }, grace);
    });
  }

  writeStdin(serverId, text) {
    const entry = this.procs.get(serverId);
    if (!entry) return false;
    try { entry.proc.stdin.write(text.endsWith('\n') ? text : text + '\n'); return true; }
    catch { return false; }
  }

  isPidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; }
    catch (err) { return err.code === 'EPERM'; }
  }

  killAll() {
    for (const [id, entry] of this.procs.entries()) {
      try { entry.proc.kill('SIGKILL'); } catch {}
      this.procs.delete(id);
    }
  }

  recentLog(serverId) {
    return (this.procs.get(serverId)?.recentLog || []).slice();
  }
}
