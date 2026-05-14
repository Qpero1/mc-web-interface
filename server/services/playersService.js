/**
 * server/services/playersService.js
 * --------------------------------------------------------------------------
 * Player roster computation. Reads usercache.json / whitelist.json /
 * banned-*.json over SFTP, scans the latest log for IPs, and probes RCON
 * for online players. Whitelist/ban/kick actions go through rconService.
 * --------------------------------------------------------------------------
 */
import * as rconService from './rconService.js';

async function readJsonIfExists(sftp, remotePath, fallback) {
  try {
    const buf = await sftp.get(remotePath);
    const str = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    return JSON.parse(str);
  } catch { return fallback; }
}
async function scanLogForIps(sftp, logPath) {
  try {
    const buf = await sftp.get(logPath);
    const text = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    const out = {};
    const re = /([A-Za-z0-9_]{2,16})\[\/?([\d.:a-fA-F]+):(\d+)\] logged in/g;
    let m; while ((m = re.exec(text)) !== null) out[m[1].toLowerCase()] = m[2];
    return out;
  } catch { return {}; }
}

/** Compute the merged roster. */
export async function roster(ctx, serverId) {
  const conn = await ctx.executor.openSftp(serverId);
  try {
    const root = conn.server.directory.replace(/\/$/, '');
    const [usercache, whitelist, bannedPlayers, bannedIps, ipsFromLogs] = await Promise.all([
      readJsonIfExists(conn.sftp, `${root}/usercache.json`, []),
      readJsonIfExists(conn.sftp, `${root}/whitelist.json`, []),
      readJsonIfExists(conn.sftp, `${root}/banned-players.json`, []),
      readJsonIfExists(conn.sftp, `${root}/banned-ips.json`, []),
      scanLogForIps(conn.sftp, `${root}/logs/latest.log`),
    ]);
    const onlineNames = await rconService.listOnlinePlayers(ctx, serverId);
    const online = new Set(onlineNames.map((n) => n.toLowerCase()));
    const wlSet = new Set(whitelist.map((w) => (w.name || '').toLowerCase()));
    const banSet = new Set(bannedPlayers.map((b) => (b.name || '').toLowerCase()));
    const banIpSet = new Set(bannedIps.map((b) => b.ip));
    const players = usercache.map((u) => {
      const lower = (u.name || '').toLowerCase();
      const ip = ipsFromLogs[lower] || null;
      return {
        name: u.name, uuid: u.uuid, ip,
        online: online.has(lower),
        whitelisted: wlSet.has(lower),
        banned: banSet.has(lower),
        ipBanned: ip ? banIpSet.has(ip) : false,
      };
    });
    for (const w of whitelist) {
      const lower = (w.name || '').toLowerCase();
      if (!players.find((p) => p.name && p.name.toLowerCase() === lower)) {
        players.push({ name: w.name, uuid: w.uuid, ip: null, online: online.has(lower), whitelisted: true, banned: banSet.has(lower), ipBanned: false });
      }
    }
    return { success: true, data: { players } };
  } catch (err) {
    return { success: false, error: { errorCode: err.code || 'UNKNOWN', message: err.message, serverId, retryable: false } };
  } finally { await conn.sftp.end().catch(() => {}); }
}

export { rconService };
