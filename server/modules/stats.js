/**
 * server/modules/stats.js
 * --------------------------------------------------------------------------
 * Server stats poller. For each configured server we periodically:
 *   - Probe RCON status (and read "list" for online player count)
 *   - Run a remote `top -bn1` (or /proc) to grab CPU and RAM usage
 *
 * Latest snapshot is cached and pushed via Socket.io. A 30-minute history
 * of player counts is kept in memory and replayed when a client subscribes.
 *
 * Frontend rooms:
 *   stats              → all servers, broadcast every tick
 *   stats:<serverId>   → individual subscription for graph replay
 * --------------------------------------------------------------------------
 */
const HISTORY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

/**
 * @param {{api:import('express').Router, io:import('socket.io').Server, registry:import('../servers.js').ServerRegistry, rconManager:import('../rcon.js').RconManager, config:object}} ctx
 */
export function registerStatsModule(ctx) {
  const { api, io, registry, rconManager, config } = ctx;

  /** @type {Map<string, {ts:number,players:number,cpu:number,ram:number,maxRam:number,online:boolean}[]>} */
  const history = new Map();
  /** @type {Map<string, object>} */
  const latest = new Map();
  /** @type {Map<string, {connected:boolean,lastSuccessAt:number|null,lastError:string|null}>} */
  const rconHealth = new Map();

  function pushHistory(serverId, point) {
    let arr = history.get(serverId);
    if (!arr) { arr = []; history.set(serverId, arr); }
    arr.push(point);
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    while (arr.length && arr[0].ts < cutoff) arr.shift();
  }

  async function tickServer(server) {
    const id = server.id;
    let players = 0;
    let online = false;
    let cpu = 0;
    let ram = 0;
    let maxRam = 0;

    try {
      const resp = await rconManager.send(id, 'list');
      online = true;
      const m = resp.match(/(\d+)\s+of\s+a\s+max\s+of\s+(\d+)/i) || resp.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) players = parseInt(m[1], 10);
    } catch (_err) {
      online = false;
    }

    try {
      // Single-pass top + free output; cheap and avoids needing extra tools
      const cmd = `top -bn1 | grep -E "^%Cpu|^Cpu|MiB Mem|KiB Mem" | head -n 4 && free -m | grep -E "^Mem:"`;
      const r = await registry.runSsh(id, cmd);
      const txt = r.stdout || '';
      const cpuMatch = txt.match(/(\d+(?:\.\d+)?)\s*id/i);
      if (cpuMatch) cpu = Math.max(0, Math.min(100, 100 - parseFloat(cpuMatch[1])));
      const memMatch = txt.match(/Mem:\s+(\d+)\s+(\d+)/);
      if (memMatch) {
        maxRam = parseInt(memMatch[1], 10);
        ram = parseInt(memMatch[2], 10);
      }
    } catch (_err) {
      // SSH might be unreachable; that's fine
    }

    const health = rconManager.status(id);
    rconHealth.set(id, health);
    const point = { ts: Date.now(), players, cpu: round(cpu, 1), ram, maxRam, online };
    pushHistory(id, point);
    latest.set(id, point);
    io.to('stats').emit('stats:update', { serverId: id, point, rcon: health });
    io.to(`stats:${id}`).emit('stats:update', { serverId: id, point, rcon: health });
  }

  async function tickAll() {
    const servers = Array.from(registry.servers.values());
    await Promise.all(servers.map((s) => tickServer(s).catch(() => {})));
  }

  const statsInterval = setInterval(tickAll, Math.max(2000, config.polling?.statsIntervalMs || 5000));
  statsInterval.unref?.();

  const rconInterval = setInterval(async () => {
    const servers = Array.from(registry.servers.values());
    await Promise.all(servers.map(async (s) => {
      await rconManager.probe(s.id).catch(() => {});
      const h = rconManager.status(s.id);
      rconHealth.set(s.id, h);
      io.to('stats').emit('stats:rcon', { serverId: s.id, rcon: h });
    }));
  }, Math.max(3000, config.polling?.rconStatusIntervalMs || 10000));
  rconInterval.unref?.();

  // Kick off an initial poll
  setTimeout(() => tickAll().catch(() => {}), 1000);

  io.on('connection', (socket) => {
    socket.on('stats:subscribe', ({ serverId } = {}) => {
      socket.join('stats');
      if (serverId) {
        socket.join(`stats:${serverId}`);
        const hist = history.get(serverId) || [];
        socket.emit('stats:history', { serverId, history: hist, rcon: rconManager.status(serverId) });
      } else {
        // Send all latest
        const snapshot = {};
        for (const [k, v] of latest.entries()) snapshot[k] = { latest: v, rcon: rconManager.status(k) };
        socket.emit('stats:snapshot', snapshot);
      }
    });
    socket.on('stats:unsubscribe', ({ serverId } = {}) => {
      if (serverId) socket.leave(`stats:${serverId}`);
    });
  });

  api.get('/stats/:id', (req, res) => {
    const id = req.params.id;
    res.json({
      latest: latest.get(id) || null,
      history: history.get(id) || [],
      rcon: rconManager.status(id),
    });
  });

  api.get('/stats', (_req, res) => {
    const out = {};
    for (const s of registry.publicList()) {
      out[s.id] = {
        latest: latest.get(s.id) || null,
        rcon: rconManager.status(s.id),
      };
    }
    res.json(out);
  });
}

function round(n, d) {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}
