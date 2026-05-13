/**
 * server/modules/worlds.js
 * --------------------------------------------------------------------------
 * World management — list world folders, upload+auto-extract zips, delete,
 * set active world by editing `level-name` in server.properties, and
 * download a world as a zip.
 *
 * Detection of a world folder: a directory in the server root that contains
 * a `level.dat` file (recursed one level). Mirrors how vanilla Minecraft
 * stores worlds.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import extract from 'extract-zip';
import multer from 'multer';

const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

/**
 * @param {{api:import('express').Router, registry:import('../servers.js').ServerRegistry, activityLog:import('../activityLog.js').ActivityLog}} ctx
 */
export function registerWorldsModule(ctx) {
  const { api, registry, activityLog } = ctx;

  api.get('/worlds/:id', async (req, res, next) => {
    let sftp;
    try {
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const entries = await sftp.list(root);
      const props = await readServerProperties(sftp, root);
      const active = props['level-name'] || 'world';
      const worlds = [];
      for (const e of entries) {
        if (e.type !== 'd') continue;
        const hasLevel = await sftp.exists(`${root}/${e.name}/level.dat`);
        if (hasLevel) {
          worlds.push({
            name: e.name,
            active: e.name === active,
            modifyTime: e.modifyTime,
          });
        }
      }
      res.json({ worlds, activeWorld: active });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.post('/worlds/:id/upload', uploadZip.single('file'), async (req, res, next) => {
    let sftp;
    let tmpZip;
    let tmpExtract;
    try {
      if (!req.file) throw Object.assign(new Error('zip file required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      tmpZip = path.join(os.tmpdir(), `mcpanel-world-${Date.now()}.zip`);
      tmpExtract = path.join(os.tmpdir(), `mcpanel-extract-${Date.now()}`);
      await fsp.writeFile(tmpZip, req.file.buffer);
      await fsp.mkdir(tmpExtract, { recursive: true });
      await extract(tmpZip, { dir: tmpExtract });

      // Locate folder containing level.dat
      const worldRoot = await findWorldRoot(tmpExtract);
      if (!worldRoot) throw Object.assign(new Error('zip does not contain a Minecraft world (no level.dat)'), { status: 400 });
      const worldName = path.basename(worldRoot);
      const remoteWorldDir = `${root}/${worldName}`;
      await sftp.mkdir(remoteWorldDir, true);
      await uploadDirectory(sftp, worldRoot, remoteWorldDir);

      activityLog.record({
        type: 'worlds.upload', serverId: req.params.id, serverName: conn.server.name, details: worldName,
      });
      res.json({ ok: true, name: worldName });
    } catch (err) { next(err); }
    finally {
      try { await sftp?.end(); } catch (_e) { /* ignore */ }
      if (tmpZip) fsp.unlink(tmpZip).catch(() => {});
      if (tmpExtract) fsp.rm(tmpExtract, { recursive: true, force: true }).catch(() => {});
    }
  });

  api.post('/worlds/:id/active', async (req, res, next) => {
    let sftp;
    try {
      const { name } = req.body || {};
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const exists = await sftp.exists(`${root}/${name}/level.dat`);
      if (!exists) throw Object.assign(new Error('world not found'), { status: 404 });
      await updateServerProperty(sftp, root, 'level-name', name);
      activityLog.record({
        type: 'worlds.set-active', serverId: req.params.id, serverName: conn.server.name, details: name,
      });
      res.json({ ok: true, activeWorld: name });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.delete('/worlds/:id', async (req, res, next) => {
    let sftp;
    try {
      const { name } = req.query;
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      await sftp.rmdir(`${root}/${name}`, true);
      activityLog.record({
        type: 'worlds.delete', serverId: req.params.id, serverName: conn.server.name, details: name,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });

  api.get('/worlds/:id/download', async (req, res, next) => {
    let sftp;
    try {
      const name = req.query.name;
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const conn = await registry.sftp(req.params.id);
      sftp = conn.sftp;
      const root = conn.server.directory.replace(/\/$/, '');
      const worldRemote = `${root}/${name}`;
      const exists = await sftp.exists(worldRemote);
      if (!exists) throw Object.assign(new Error('world not found'), { status: 404 });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.zip"`);
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => next(err));
      archive.pipe(res);
      await streamRemoteDirIntoZip(sftp, worldRemote, name, archive);
      await archive.finalize();
    } catch (err) { next(err); }
    finally { try { await sftp?.end(); } catch (_e) { /* ignore */ } }
  });
}

async function readServerProperties(sftp, root) {
  try {
    const buf = await sftp.get(`${root}/server.properties`);
    const txt = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
    const out = {};
    for (const line of txt.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return out;
  } catch (_err) {
    return {};
  }
}

async function updateServerProperty(sftp, root, key, value) {
  let txt = '';
  try {
    const buf = await sftp.get(`${root}/server.properties`);
    txt = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  } catch (_err) {
    txt = '';
  }
  const lines = txt.split(/\r?\n/);
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || lines[i].startsWith('#')) continue;
    const idx = lines[i].indexOf('=');
    if (idx === -1) continue;
    if (lines[i].slice(0, idx).trim() === key) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sftp.put(Readable.from(lines.join('\n')), `${root}/server.properties`);
}

async function findWorldRoot(localDir) {
  if (fs.existsSync(path.join(localDir, 'level.dat'))) return localDir;
  const entries = await fsp.readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(localDir, e.name);
    if (fs.existsSync(path.join(sub, 'level.dat'))) return sub;
  }
  return null;
}

async function uploadDirectory(sftp, localDir, remoteDir) {
  await sftp.mkdir(remoteDir, true);
  const entries = await fsp.readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    const localPath = path.join(localDir, e.name);
    const remotePath = `${remoteDir}/${e.name}`;
    if (e.isDirectory()) {
      await uploadDirectory(sftp, localPath, remotePath);
    } else if (e.isFile()) {
      await sftp.fastPut(localPath, remotePath);
    }
  }
}

async function streamRemoteDirIntoZip(sftp, remoteDir, prefix, archive) {
  const entries = await sftp.list(remoteDir);
  for (const e of entries) {
    const remotePath = `${remoteDir}/${e.name}`;
    const zipPath = `${prefix}/${e.name}`;
    if (e.type === 'd') {
      await streamRemoteDirIntoZip(sftp, remotePath, zipPath, archive);
    } else if (e.type === '-') {
      const data = await sftp.get(remotePath);
      archive.append(data, { name: zipPath });
    }
  }
}
