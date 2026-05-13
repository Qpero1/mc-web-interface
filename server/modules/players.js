/**
 * server/modules/players.js
 * --------------------------------------------------------------------------
 * Player roster and moderation:
 *   - GET  /api/players/:id              → list with whitelist/online/IP
 *   - POST /api/players/:id/whitelist    → add/remove
 *   - POST /api/players/:id/ban          → name or IP ban
 *   - POST /api/players/:id/kick         → kick currently-online player
 *
 * Roster is derived from:
 *   - usercache.json (UUID + last seen names)
 *   - whitelist.json
 *   - banned-players.json / banned-ips.json
 *   - logs (player IP from "logged in with entity id ..." lines)
 *   - RCON "list" for current online
 * --------------------------------------------------------------------------
 */
import path from 'node:path';

/**
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, rconManager:import('../rcon.js').RconManager, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerPlayersModule(ctx) {
  const { api, registry, rconManager, activityLog } = ctx;

  api.get('/players/:id', async (req, res, next) => {
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');

      const [usercache, whitelist, bannedPlayers, bannedIps, ipsFromLogs] = await Promise.all([
        readJsonIfExists(sftp, `${root}/usercache.json`, []),
        readJsonIfExists(sftp, `${root}/whitelist.json`, []),
        readJsonIfExists(sftp, `${root}/banned-players.json`, []),
        readJsonIfExists(sftp, `${root}/banned-ips.json`, []),
        scanLogForIps(sftp, `${root}/logs/latest.log`).catch(() => ({})),
      ]);

      // Online players via RCON
      let online = new Set();
      try {
        const listResp = await rconManager.send(req.params.id, 'list');
        for (const name of parseListResponse(listResp)) online.add(name.toLowerCase());
      } catch (_err) { /* server may be offline */ }

      const wlSet = new Set(whitelist.map((w) => (w.name || '').toLowerCase()));
      const banSet = new Set(bannedPlayers.map((b) => (b.name || '').toLowerCase()));
      const banIpSet = new Set(bannedIps.map((b) => b.ip));

      const players = usercache.map((u) => {
        const lower = (u.name || '').toLowerCase();
        return {
          name: u.name,
          uuid: u.uuid,
          ip: ipsFromLogs[lower] || null,
          online: online.has(lower),
          whitelisted: wlSet.has(lower),
          banned: banSet.has(lower),
          ipBanned: ipsFromLogs[lower] ? banIpSet.has(ipsFromLogs[lower]) : false,
        };
      });

      // Include any whitelist entries not in usercache
      for (const w of whitelist) {
        const lower = (w.name || '').toLowerCase();
        if (!players.find((p) => p.name && p.name.toLowerCase() === lower)) {
          players.push({
            name: w.name, uuid: w.uuid, ip: null,
            online: online.has(lower), whitelisted: true, banned: banSet.has(lower), ipBanned: false,
          });
        }
      }

      res.json({ players });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/players/:id/whitelist', async (req, res, next) => {
    try {
      const { name, action } = req.body || {};
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const cmd = action === 'remove' ? `whitelist remove ${name}` : `whitelist add ${name}`;
      const response = await rconManager.send(req.params.id, cmd);
      activityLog.record({
        type: `players.whitelist.${action === 'remove' ? 'remove' : 'add'}`,
        serverId: req.params.id, serverName: registry.get(req.params.id)?.name, details: name,
      });
      res.json({ response });
    } catch (err) { next(err); }
  });

  api.post('/players/:id/ban', async (req, res, next) => {
    try {
      const { name, ip, mode = 'name', reason = '' } = req.body || {};
      let cmd;
      if (mode === 'ip') {
        if (!ip && !name) throw Object.assign(new Error('ip or name required'), { status: 400 });
        cmd = `ban-ip ${ip || name} ${reason}`.trim();
      } else if (mode === 'pardon') {
        cmd = `pardon ${name}`;
      } else if (mode === 'pardon-ip') {
        cmd = `pardon-ip ${ip || name}`;
      } else {
        if (!name) throw Object.assign(new Error('name required'), { status: 400 });
        cmd = `ban ${name} ${reason}`.trim();
      }
      const response = await rconManager.send(req.params.id, cmd);
      activityLog.record({
        type: `players.${mode === 'pardon' || mode === 'pardon-ip' ? 'pardon' : 'ban'}`,
        serverId: req.params.id, serverName: registry.get(req.params.id)?.name,
        details: `${cmd} ${reason ? `(${reason})` : ''}`.trim(),
      });
      res.json({ response });
    } catch (err) { next(err); }
  });

  api.post('/players/:id/kick', async (req, res, next) => {
    try {
      const { name, reason = '' } = req.body || {};
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const response = await rconManager.send(req.params.id, `kick ${name} ${reason}`.trim());
      activityLog.record({
        type: 'players.kick', serverId: req.params.id, serverName: registry.get(req.params.id)?.name,
        details: `${name} ${reason ? `(${reason})` : ''}`.trim(),
      });
      res.json({ response });
    } catch (err) { next(err); }
  });
}

async function readJsonIfExists(sftp, remotePath, fallback) {
  try {
    const data = await sftp.get(remotePath);
    const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    return JSON.parse(str);
  } catch (_err) {
    return fallback;
  }
}

async function scanLogForIps(sftp, logPath) {
  try {
    const data = await sftp.get(logPath);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const result = {};
    // Matches:  Player[/127.0.0.1:12345] logged in
    const re = /([A-Za-z0-9_]{2,16})\[\/?([\d.:a-fA-F]+):(\d+)\] logged in/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      result[m[1].toLowerCase()] = m[2];
    }
    return result;
  } catch (_err) {
    return {};
  }
}

function parseListResponse(resp) {
  // "There are 2 of a max of 20 players online: Foo, Bar"
  if (!resp) return [];
  const idx = resp.indexOf(':');
  if (idx === -1) return [];
  return resp.slice(idx + 1).split(',').map((s) => s.trim()).filter(Boolean);
}
