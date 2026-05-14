/**
 * agent/index.js
 * --------------------------------------------------------------------------
 * Headless agent entry. Loads config, wires subsystems, performs restart
 * reconciliation, and exposes a small local HTTP control surface (`POST
 * /jobs`, `GET /state`, `GET /health`) bound to 127.0.0.1 only.
 *
 * This is the long-lived process that runs on the Minecraft host machine.
 * It serves no UI and never accepts public connections. The cloud
 * connector hook is a stub for a later phase.
 *
 * Run with:
 *   node agent/index.js
 * --------------------------------------------------------------------------
 */
import 'dotenv/config';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadAgentConfig } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { ProcessManager } from './processManager.js';
import { StateManager } from './stateManager.js';
import { LogStreamer } from './logStreamer.js';
import { RconClientManager } from './rconClient.js';
import { Heartbeat } from './heartbeat.js';
import { createJobHandler } from './jobHandler.js';
import { reconcile } from './recovery.js';
import { CloudConnector } from './cloudConnector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startAgent({ configPath } = {}) {
  const config = await loadAgentConfig(configPath);
  setLogLevel(config.agent.logLevel || 'info');
  logger.info('agent.start', { configPath: config._path, servers: config.servers.map((s) => s.id) });

  const processManager = new ProcessManager();
  const stateManager = new StateManager(path.resolve(path.dirname(config._path), config.agent.statePersistPath), processManager);
  await stateManager.init();
  const logStreamer = new LogStreamer(config.agent.maxLogBacklog);
  const rcon = new RconClientManager();

  // Wire process events into state/log/RCON systems
  processManager.on('log', ({ serverId, line }) => logStreamer.pushLine(serverId, line));
  processManager.on('stopped', ({ serverId }) => {
    rcon.forget(serverId);
    stateManager.setState(serverId, { process: 'offline', rcon: 'disconnected', pid: null });
  });
  processManager.on('crashed', ({ serverId, code, signal, recentLog }) => {
    rcon.forget(serverId);
    stateManager.setState(serverId, { process: 'crashed', rcon: 'disconnected', pid: null, crash: { code, signal, recentLog } });
    logger.warn('server.crashed', { serverId, code, signal });
    // Optional auto-restart
    const server = config.servers.find((s) => s.id === serverId);
    if (server?.autoRestart) {
      setTimeout(() => jobHandler.dispatch({ type: 'startServer', serverId }).catch(() => {}), 2000);
    }
  });
  rcon.on('ready', ({ serverId }) => stateManager.setState(serverId, { rcon: 'ready', process: stateManager.getState(serverId).process === 'starting' ? 'online' : stateManager.getState(serverId).process }));
  rcon.on('disconnected', ({ serverId }) => stateManager.setState(serverId, { rcon: 'disconnected' }));

  const jobHandler = createJobHandler({ config, stateManager, processManager, logStreamer, rcon, agentConfig: config.agent });

  await reconcile({ config, stateManager, logStreamer, rcon, agentConfig: config.agent });

  const heartbeat = new Heartbeat({ stateManager, processManager, rcon, intervalMs: config.agent.heartbeatIntervalMs });
  heartbeat.start();
  const cloud = new CloudConnector();
  cloud.start();

  // Local HTTP control surface — 127.0.0.1 only.
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      }
      if (req.method === 'GET' && req.url === '/state') {
        return res.end(JSON.stringify({ states: stateManager.getAllStates() }));
      }
      if (req.method === 'POST' && req.url === '/jobs') {
        const body = await readJson(req);
        const result = await jobHandler.dispatch(body || {});
        res.statusCode = result.success ? 200 : 400;
        return res.end(JSON.stringify(result));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      logger.error('http.error', { error: err });
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });
  await new Promise((resolve) => server.listen(config.agent.port, '127.0.0.1', resolve));
  logger.info('agent.listening', { port: config.agent.port });

  const shutdown = async () => {
    logger.info('agent.shutdown');
    heartbeat.stop();
    cloud.stop();
    logStreamer.closeAll();
    await rcon.disposeAll();
    processManager.killAll();
    try { await stateManager.flushNow(); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { processManager, stateManager, logStreamer, rcon, jobHandler, heartbeat, server, shutdown };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { buf += c; if (buf.length > 10 * 1024 * 1024) req.destroy(new Error('payload too large')); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

// Direct-run entrypoint
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  startAgent().catch((err) => { logger.error('agent.fatal', { error: err }); process.exit(1); });
}
