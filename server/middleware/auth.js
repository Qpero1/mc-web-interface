/**
 * server/middleware/auth.js
 * --------------------------------------------------------------------------
 * Authentication primitives. Exports:
 *   - createAuthRouter(config, activityLog) — Express router with /login & /logout
 *   - createAuthMiddleware(config) — middleware that gates /api/*
 *   - registerSocketAuth(io, config) — verifies Socket.io handshake JWTs
 *
 * Credentials are stored in config.json (bcrypt hash). JWTs are HS256.
 * --------------------------------------------------------------------------
 */
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Build an Express router exposing /login and /logout.
 * @param {object} config
 * @param {import('../activityLog.js').ActivityLog} activityLog
 */
export function createAuthRouter(config, activityLog) {
  const router = express.Router();
  const { username: configuredUser, passwordHash } = config.auth || {};

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    if (!configuredUser || !passwordHash) {
      return res.status(500).json({ error: 'Panel auth not configured. Edit config.json.' });
    }
    if (username !== configuredUser) {
      activityLog.record({ type: 'auth.login.failed', details: `Unknown user "${username}"` });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    let ok = false;
    try {
      ok = await bcrypt.compare(password, passwordHash);
    } catch (_err) {
      ok = false;
    }
    if (!ok) {
      activityLog.record({ type: 'auth.login.failed', details: `Bad password for "${username}"` });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { sub: username, username },
      config.panel.jwtSecret,
      { expiresIn: config.panel.sessionTtl || 43200 }
    );
    activityLog.record({ type: 'auth.login', details: `User "${username}" logged in` });
    res.json({ token, username });
  });

  router.post('/logout', (req, res) => {
    activityLog.record({ type: 'auth.logout', details: 'User logged out' });
    res.json({ ok: true });
  });

  return router;
}

/**
 * Express middleware that requires a valid Authorization: Bearer <jwt>.
 * @param {object} config
 */
export function createAuthMiddleware(config) {
  return function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const [scheme, headerToken] = header.split(' ');
    // Allow ?token=... as a fallback for browser <a> download links
    const token = scheme === 'Bearer' && headerToken ? headerToken : (req.query.token || null);
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    try {
      const payload = jwt.verify(token, config.panel.jwtSecret);
      req.user = { username: payload.username };
      next();
    } catch (_err) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/**
 * Verify JWTs on Socket.io connections. Token can come via
 * socket.handshake.auth.token or the auth query param.
 *
 * @param {import('socket.io').Server} io
 * @param {object} config
 */
export function registerSocketAuth(io, config) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Missing token'));
    try {
      const payload = jwt.verify(token, config.panel.jwtSecret);
      socket.user = { username: payload.username };
      next();
    } catch (_err) {
      next(new Error('Invalid token'));
    }
  });
}
