/**
 * server/services/logService.js
 * --------------------------------------------------------------------------
 * Live log streaming. Opens an SSH connection per (server, active),
 * tails the remote `logs/latest.log`, ring-buffers the last 500 lines,
 * and fans out to registered listeners.
 * --------------------------------------------------------------------------
 */
import { Client as SshClient } from 'ssh2';
import { emit, EVENTS } from '../events/emitter.js';

const RING_BUFFER = 500;

function shellEscape(p) { return `'${String(p).replace(/'/g, `'\\''`)}'`; }

export function createLogService(ctx) {
  const { registry } = ctx;
  /** @type {Map<string,{conn:SshClient,lines:string[],listeners:Set<Function>,starting:boolean}>} */
  const streams = new Map();

  function broadcast(id, line) {
    const entry = streams.get(id);
    if (!entry) return;
    entry.lines.push(line);
    if (entry.lines.length > RING_BUFFER) entry.lines.shift();
    emit(EVENTS.LOG_LINE, { serverId: id, line, ts: Date.now() });
    for (const fn of entry.listeners) {
      try { fn({ serverId: id, line, ts: Date.now() }); } catch {}
    }
  }

  async function startTail(id) {
    const server = registry.require(id);
    const opts = await registry.sshOptions(server);
    const conn = new SshClient();
    const entry = streams.get(id);
    entry.conn = conn;
    const logPath = `${server.directory.replace(/\/$/, '')}/logs/latest.log`;
    const cmd = `tail -n 200 -F ${shellEscape(logPath)}`;
    await new Promise((resolve, reject) => {
      conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) return reject(err);
          resolve();
          let buf = '';
          stream.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            const parts = buf.split('\n');
            buf = parts.pop();
            for (const line of parts) if (line) broadcast(id, line);
          });
          stream.stderr.on('data', () => {});
          stream.on('close', () => { conn.end(); streams.delete(id); });
        });
      });
      conn.on('error', (err) => { streams.delete(id); reject(err); });
      conn.connect(opts);
    });
  }

  return {
    /** Subscribe; returns unsubscribe. */
    subscribe(id, fn) {
      let entry = streams.get(id);
      if (!entry) {
        entry = { conn: null, lines: [], listeners: new Set(), starting: true };
        streams.set(id, entry);
        startTail(id).catch((err) => emit(EVENTS.LOG_LINE, { serverId: id, line: `[tail error] ${err.message}`, ts: Date.now() }));
      }
      entry.listeners.add(fn);
      // Replay backlog
      try { fn({ serverId: id, replay: true, lines: entry.lines.slice() }); } catch {}
      return () => {
        entry.listeners.delete(fn);
        if (entry.listeners.size === 0) {
          try { entry.conn?.end(); } catch {}
          streams.delete(id);
        }
      };
    },
    /** Get current backlog. */
    backlog(id) { return (streams.get(id)?.lines || []).slice(); },
  };
}
