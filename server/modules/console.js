/**
 * server/modules/console.js
 * --------------------------------------------------------------------------
 * Live console streaming and RCON command execution.
 *
 * Streams the remote `logs/latest.log` via SSH `tail -f` and broadcasts new
 * lines to clients in the `console:<serverId>` Socket.io room. Clients can
 * also POST commands to /api/console/:id/send which are sent over RCON.
 * --------------------------------------------------------------------------
 */
import { Client as SshClient } from 'ssh2';

const RING_BUFFER = 500; // lines per server held in memory for new joiners

/**
 * Wire the console module into the API router and Socket.io server.
 * @param {{api:import('express').Router, io:import('socket.io').Server, registry:import('../servers.js').ServerRegistry, rconManager:import('../rcon.js').RconManager, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerConsoleModule(ctx) {
  const { api, io, registry, rconManager, activityLog } = ctx;

  /** @type {Map<string, {conn:SshClient, lines:string[], refs:number}>} */
  const streams = new Map();

  function getOrStart(id) {
    let entry = streams.get(id);
    if (entry) return entry;
    entry = { conn: null, lines: [], refs: 0 };
    streams.set(id, entry);
    startTail(id, entry).catch((err) => {
      io.to(`console:${id}`).emit('console:error', { serverId: id, message: err.message });
    });
    return entry;
  }

  async function startTail(id, entry) {
    const server = registry.require(id);
    const opts = await registry.sshOptions(server);
    const conn = new SshClient();
    entry.conn = conn;
    const logPath = `${server.directory.replace(/\/$/, '')}/logs/latest.log`;
    const cmd = `tail -n 200 -F ${shellEscape(logPath)}`;

    return new Promise((resolve, reject) => {
      conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) { reject(err); return; }
          resolve();
          let buf = '';
          stream.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            const parts = buf.split('\n');
            buf = parts.pop();
            for (const line of parts) {
              if (!line) continue;
              entry.lines.push(line);
              if (entry.lines.length > RING_BUFFER) entry.lines.shift();
              io.to(`console:${id}`).emit('console:line', { serverId: id, line, ts: Date.now() });
            }
          });
          stream.stderr.on('data', (chunk) => {
            io.to(`console:${id}`).emit('console:stderr', { serverId: id, line: chunk.toString('utf8') });
          });
          stream.on('close', () => {
            conn.end();
            streams.delete(id);
            io.to(`console:${id}`).emit('console:closed', { serverId: id });
          });
        });
      });
      conn.on('error', (err) => {
        streams.delete(id);
        io.to(`console:${id}`).emit('console:error', { serverId: id, message: err.message });
        reject(err);
      });
      conn.connect(opts);
    });
  }

  io.on('connection', (socket) => {
    socket.on('console:subscribe', ({ serverId } = {}) => {
      if (!serverId || !registry.get(serverId)) return;
      socket.join(`console:${serverId}`);
      const entry = getOrStart(serverId);
      entry.refs += 1;
      // Replay the ring buffer to the joiner
      socket.emit('console:replay', { serverId, lines: entry.lines.slice() });
    });
    socket.on('console:unsubscribe', ({ serverId } = {}) => {
      if (!serverId) return;
      socket.leave(`console:${serverId}`);
      const entry = streams.get(serverId);
      if (entry) {
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.refs === 0) {
          try { entry.conn?.end(); } catch (_e) { /* ignore */ }
          streams.delete(serverId);
        }
      }
    });
    socket.on('disconnect', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('console:')) {
          const id = room.slice('console:'.length);
          const entry = streams.get(id);
          if (entry) {
            entry.refs = Math.max(0, entry.refs - 1);
            if (entry.refs === 0) {
              try { entry.conn?.end(); } catch (_e) { /* ignore */ }
              streams.delete(id);
            }
          }
        }
      }
    });
  });

  // REST: send command via RCON
  api.post('/console/:id/send', async (req, res, next) => {
    try {
      const { id } = req.params;
      const { command } = req.body || {};
      if (!command) throw Object.assign(new Error('command required'), { status: 400 });
      const response = await rconManager.send(id, command.replace(/^\//, ''));
      activityLog.record({
        type: 'console.command',
        serverId: id,
        serverName: registry.get(id)?.name,
        details: command,
      });
      io.to(`console:${id}`).emit('console:line', {
        serverId: id,
        line: `[RCON] > ${command}`,
        ts: Date.now(),
      });
      if (response) {
        io.to(`console:${id}`).emit('console:line', {
          serverId: id,
          line: `[RCON] ${response}`,
          ts: Date.now(),
        });
      }
      res.json({ response });
    } catch (err) { next(err); }
  });

  // REST: tail-style fetch (useful when sockets aren't available)
  api.get('/console/:id/tail', async (req, res, next) => {
    try {
      const id = req.params.id;
      const entry = streams.get(id);
      res.json({ lines: entry ? entry.lines.slice(-500) : [] });
    } catch (err) { next(err); }
  });
}

function shellEscape(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}
