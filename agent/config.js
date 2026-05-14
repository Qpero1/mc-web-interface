/**
 * agent/config.js
 * --------------------------------------------------------------------------
 * Loads agent-config.json from a path resolvable from the agent's cwd,
 * with sensible defaults and validation. Throws structured errors on
 * invalid configs so the agent can refuse to start without crashing.
 * --------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_AGENT = {
  port: 9001,
  logLevel: 'info',
  statePersistPath: './agent-state.json',
  backupDirectory: './backups',
  maxLogBacklog: 500,
  heartbeatIntervalMs: 10000,
  rconReadyTimeoutMs: 120000,
};

/**
 * Load the agent config from disk.
 * @param {string} [configPath]
 * @returns {Promise<{servers:object[], agent:object, _path:string}>}
 */
export async function loadAgentConfig(configPath) {
  const target = configPath || process.env.AGENT_CONFIG || path.resolve(process.cwd(), 'agent-config.json');
  let raw;
  try { raw = await fs.readFile(target, 'utf8'); }
  catch (err) {
    const e = new Error(`agent-config.json not found at ${target} (copy agent-config.example.json and edit it)`);
    e.code = 'CONFIG_MISSING'; throw e;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    const e = new Error(`agent-config.json is not valid JSON: ${err.message}`);
    e.code = 'CONFIG_INVALID_JSON'; throw e;
  }
  const servers = Array.isArray(parsed.servers) ? parsed.servers : [];
  for (const s of servers) {
    if (!s.id) throw Object.assign(new Error('server.id required'), { code: 'CONFIG_INVALID' });
    if (!s.directory) throw Object.assign(new Error(`server[${s.id}].directory required`), { code: 'CONFIG_INVALID' });
    if (!s.startCommand) throw Object.assign(new Error(`server[${s.id}].startCommand required`), { code: 'CONFIG_INVALID' });
    s.name = s.name || s.id;
    s.stopGraceMs = parseInt(s.stopGraceMs, 10) || 30000;
    s.rconPort = parseInt(s.rconPort, 10) || 25575;
    s.rconPassword = s.rconPassword || '';
    s.javaPath = s.javaPath || 'java';
    s.autoRestart = !!s.autoRestart;
    s.port = parseInt(s.port, 10) || 25565;
  }
  const agent = { ...DEFAULT_AGENT, ...(parsed.agent || {}) };
  return { servers, agent, _path: target };
}

/** Find a server config by id. Throws SERVER_NOT_FOUND if missing. */
export function getServer(config, serverId) {
  const s = config.servers.find((x) => x.id === serverId);
  if (!s) {
    const e = new Error(`Server with id '${serverId}' was not found in config`);
    e.code = 'SERVER_NOT_FOUND'; throw e;
  }
  return s;
}
