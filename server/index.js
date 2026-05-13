/**
 * server/index.js
 * --------------------------------------------------------------------------
 * Entry point for the mc-panel backend. Boots Express + Socket.io, loads
 * configuration, wires up the auth middleware, mounts each feature module,
 * and (in production) serves the prebuilt React client.
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
import { registerConsoleModule } from './modules/console.js';
import { registerFilesModule } from './modules/files.js';
import { registerPlayersModule } from './modules/players.js';
import { registerModsModule } from './modules/mods.js';
import { registerWorldsModule } from './modules/worlds.js';
import { registerBackupsModule } from './modules/backups.js';
import { registerStatsModule } from './modules/stats.js';
import { registerConfigEditorModule } from './modules/config-editor.js';

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

  // Shared services
  const activityLog = new ActivityLog(config, rootDir);
  await activityLog.init();

  const registry = new ServerRegistry(config, rootDir, activityLog);
  await registry.load();

  const rconManager = new RconManager(registry, config);

  // Authentication
  const auth = createAuthMiddleware(config);
  registerSocketAuth(io, config);
  app.use('/api/auth', createAuthRouter(config, activityLog));

  // Public health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: '1.0.0', time: Date.now() });
  });

  // Protected API
  const api = express.Router();
  api.use(auth);

  api.get('/me', (req, res) => {
    res.json({ username: req.user.username });
  });

  api.get('/activity', (req, res) => {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 100));
    res.json({ entries: activityLog.recent(limit) });
  });

  // Server CRUD
  api.get('/servers', (_req, res) => {
    res.json({ servers: registry.publicList() });
  });
  api.post('/servers', async (req, res, next) => {
    try {
      const created = await registry.addServer(req.body);
      activityLog.record({ type: 'server.add', serverId: created.id, serverName: created.name, details: 'Server added' });
      res.json({ server: registry.publicView(created.id) });
    } catch (err) { next(err); }
  });
  api.put('/servers/:id', async (req, res, next) => {
    try {
      const updated = await registry.updateServer(req.params.id, req.body);
      activityLog.record({ type: 'server.update', serverId: updated.id, serverName: updated.name, details: 'Server updated' });
      res.json({ server: registry.publicView(updated.id) });
    } catch (err) { next(err); }
  });
  api.delete('/servers/:id', async (req, res, next) => {
    try {
      const removed = await registry.removeServer(req.params.id);
      activityLog.record({ type: 'server.remove', serverId: removed.id, serverName: removed.name, details: 'Server removed' });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Lifecycle (start/stop/restart) — runs the configured shell command via SSH
  api.post('/servers/:id/lifecycle/:action', async (req, res, next) => {
    try {
      const { id, action } = req.params;
      const result = await registry.runLifecycle(id, action);
      activityLog.record({
        type: `server.${action}`,
        serverId: id,
        serverName: registry.get(id)?.name || id,
        details: `Lifecycle action: ${action}`,
      });
      res.json(result);
    } catch (err) { next(err); }
  });

  // Modules
  registerConsoleModule({ api, io, registry, rconManager, activityLog });
  registerFilesModule({ api, registry, activityLog });
  registerPlayersModule({ api, registry, rconManager, activityLog });
  registerModsModule({ api, registry, activityLog });
  registerWorldsModule({ api, registry, activityLog });
  registerBackupsModule({ api, registry, activityLog, rootDir });
  registerStatsModule({ api, io, registry, rconManager, config });
  registerConfigEditorModule({ api, registry, activityLog });

  app.use('/api', api);

  // Error handler
  app.use((err, _req, res, _next) => {
    // eslint-disable-next-line no-console
    console.error('[api error]', err.message);
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  // Static client (production)
  const clientDist = path.join(rootDir, 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('text/plain').send('mc-panel API is running. Start the Vite dev server with `npm run dev:client`.');
    });
  }

  const host = process.env.HOST || config.panel.host || '0.0.0.0';
  const port = parseInt(process.env.PORT, 10) || config.panel.port || 8787;

  httpServer.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[mc-panel] listening on http://${host}:${port}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[mc-panel] ${signal} received, shutting down...`);
    try {
      await rconManager.disposeAll();
      await activityLog.close();
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('shutdown error', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[mc-panel] fatal:', err);
  process.exit(1);
});
