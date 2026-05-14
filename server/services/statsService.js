/**
 * server/services/statsService.js
 * --------------------------------------------------------------------------
 * Stats polling — RCON online check + CPU/RAM via `top`/`free` over SSH.
 * Maintains a 30-minute rolling history per server and emits stats:updated
 * events on each tick.
 * --------------------------------------------------------------------------
 */
import { emit, EVENTS } from '../events/emitter.js';

const HISTORY_WINDOW_MS = 30 * 60 * 1000;

export function createStatsService(ctx, { intervalMs = 5000 } = {}) {
  const { executor, registry, rconManager } = ctx;
  const history = new Map();
  const latest = new Map();
  let timer = null;

  function pushHistory(serverId, point) {
    let arr = history.get(serverId);
    if (!arr) { arr = []; history.set(serverId, arr); }
    arr.push(point);
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    while (arr.length && arr[0].ts < cutoff) arr.shift();
  }

  async function tickServer(server) {
    const id = server.id;
    let players = 0; let online = false; let cpu = 0; let ram = 0; let maxRam = 0;
    try {
      const r = await executor.executeRcon(id, 'list');
      if (r.success) {
        online = true;
        const m = (r.data.response || '').match(/(\d+)\s+of\s+a\s+max\s+of\s+(\d+)/i);
        if (m) players = parseInt(m[1], 10);
      }
    } catch {}
    try {
      const r = await executor.runShell(id, 'top -bn1 | grep -E "^%Cpu|^Cpu|MiB Mem|KiB Mem" | head -n 4 && free -m | grep -E "^Mem:"');
      if (r.success) {
        const txt = r.data.stdout || '';
        const cpuMatch = txt.match(/(\d+(?:\.\d+)?)\s*id/i);
        if (cpuMatch) cpu = Math.max(0, Math.min(100, 100 - parseFloat(cpuMatch[1])));
        const memMatch = txt.match(/Mem:\s+(\d+)\s+(\d+)/);
        if (memMatch) { maxRam = parseInt(memMatch[1], 10); ram = parseInt(memMatch[2], 10); }
      }
    } catch {}
    const point = { ts: Date.now(), players, cpu: Math.round(cpu * 10) / 10, ram, maxRam, online };
    pushHistory(id, point);
    latest.set(id, point);
    emit(EVENTS.STATS_UPDATED, { serverId: id, point, rcon: rconManager.status(id) });
  }

  async function tickAll() {
    const servers = Array.from(registry.servers.values());
    await Promise.all(servers.map((s) => tickServer(s).catch(() => {})));
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tickAll, Math.max(2000, intervalMs));
      timer.unref?.();
      setTimeout(() => tickAll().catch(() => {}), 1000);
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    getLatest(id) { return latest.get(id) || null; },
    getHistory(id) { return history.get(id) || []; },
    snapshot() {
      const out = {};
      for (const id of latest.keys()) out[id] = { latest: latest.get(id), rcon: rconManager.status(id) };
      return out;
    },
  };
}
