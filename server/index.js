/**
 * server/index.js
 * --------------------------------------------------------------------------
 * Backend entry. Boots Express + Socket.io, loads config, wires auth, and
 * mounts the REST and Socket.io adapters. All domain logic lives in
 * server/services/* and is reached via server/execution/localExecutor.js.
 * --------------------------------------------------------------------------
 */
import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketIoServer } from 'socket.io';

import { loadConfig } from './config.js';
import { createAuthMiddleware, createAuthRouter, registerSocketAuth } from './middleware/auth.js';
import { ServerRegistry } from './servers.js';
import { RconManager } from './rcon.js';
import { ActivityLog } from './activityLog.js';
import { createLocalExecutor } from './execution/localExecutor.js';
import { createStatsService } from './services/statsService.js';
import { createLogService } from './services/logService.js';
import { createBackupService } from './services/backupService.js';
import { registerRestAdapter } from './adapters/rest.js';
import { registerSocketAdapter } from './adapters/socketio.js';
import { registerCloudAdapter } from './adapters/cloudAdapter.js';

// Silence ssh2's noisy "close event raised" messages on retries
const _origConsoleLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Global close listener')) return;
  _origConsoleLog.apply(console, args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function main() {
  const config = await loadConfig(rootDir);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

  const httpServer = http.createServer(app);
  const io = new SocketIoServer(httpServer, {
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 50 * 1024 * 1024,
  });

  // Shared infrastructure
  const activityLog = new ActivityLog(config, rootDir);
  await activityLog.init();
  const registry = new ServerRegistry(config, rootDir, activityLog);
  await registry.load();
  const rconManager = new RconManager(registry, config);

  // Phase-2 boundary: every service/adapter talks to the machine through this.
  const executor = createLocalExecutor({ registry, rconManager });
  const ctx = { executor, registry, rconManager };

  // Stateful services
  const statsService = createStatsService(ctx, { intervalMs: config.polling?.statsIntervalMs || 5000 });
  const logService = createLogService(ctx);
  const backupService = createBackupService(ctx, { schedulesFile: config.backups.schedulesFile });
  await backupService.init();
  statsService.start();

  // Auth
  registerSocketAuth(io, config);
  app.use('/api/auth', createAuthRouter(config, activityLog));
  const auth = createAuthMiddleware(config);

  // Health (public)
  app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0', time: Date.now() }));

  // Mount the REST adapter behind auth
  const api = express.Router();
  api.use(auth);
  api.use(registerRestAdapter({ ctx, activityLog, backupService, statsService }));
  app.use('/api', api);

  // Socket.io adapter
  registerSocketAdapter({ io, ctx, statsService, logService });

  // Cloud adapter stub
  await registerCloudAdapter({ ctx });

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error('[api error]', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  // Static client (production)
  const clientDist = path.join(rootDir, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text/plain').send('mc-panel API is running. Start the Vite dev server with `npm run dev:client`.'));
  }

  const host = process.env.HOST || config.panel.host || '0.0.0.0';
  const port = parseInt(process.env.PORT, 10) || config.panel.port || 8787;
  httpServer.listen(port, host, () => console.log(`[mc-panel] listening on http://${host}:${port}`));

  const shutdown = async () => {
    try {
      statsService.stop();
      await rconManager.disposeAll();
      await activityLog.close();
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (err) { console.error('shutdown error', err); process.exit(1); }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('[mc-panel] fatal:', err); process.exit(1); });
