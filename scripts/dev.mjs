#!/usr/bin/env node
/**
 * scripts/dev.mjs
 * --------------------------------------------------------------------------
 * Zero-dependency replacement for `concurrently`. Spawns the backend (with
 * NODE_ENV=development and a built-in file watcher restart loop) and the
 * Vite client at the same time, prefixes their output, and tears both down
 * when either exits or the user hits Ctrl+C. Works on Windows, macOS, Linux.
 * --------------------------------------------------------------------------
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const COLORS = { server: '\x1b[34m', client: '\x1b[32m', reset: '\x1b[0m', dim: '\x1b[2m' };
function prefix(name, color) {
  const pad = name.padEnd(6);
  return `${color}[${pad}]${COLORS.reset} `;
}

/** Pipe a subprocess's stdout/stderr through a prefixed writer. */
function pipe(child, name, color) {
  const writeLines = (stream, target) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) target.write(prefix(name, color) + line + '\n');
    });
    stream.on('end', () => { if (buf) target.write(prefix(name, color) + buf + '\n'); });
  };
  writeLines(child.stdout, process.stdout);
  writeLines(child.stderr, process.stderr);
}

const isWin = process.platform === 'win32';

/** Spawn the backend Node process and restart it whenever a server/* file changes. */
function startServer() {
  let proc = null;
  let restartTimer = null;
  let stopping = false;

  const launch = () => {
    if (proc) {
      try { proc.kill(); } catch (_e) { /* ignore */ }
    }
    proc = spawn(process.execPath, ['server/index.js'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipe(proc, 'server', COLORS.server);
    proc.on('exit', (code, signal) => {
      if (stopping) return;
      if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
        process.stdout.write(prefix('server', COLORS.server) + COLORS.dim + `exited with code ${code}, waiting for changes…` + COLORS.reset + '\n');
      }
    });
  };

  const restart = () => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      process.stdout.write(prefix('server', COLORS.server) + COLORS.dim + 'change detected — restarting' + COLORS.reset + '\n');
      launch();
    }, 200);
  };

  // Watch server/ recursively where possible; ignore on Linux without recursive support.
  const recursive = isWin || process.platform === 'darwin';
  try {
    watch(path.join(root, 'server'), { recursive }, () => restart());
  } catch (_e) {
    process.stdout.write(prefix('server', COLORS.server) + COLORS.dim + '(no recursive watch — restart manually if needed)' + COLORS.reset + '\n');
  }

  launch();

  return {
    stop: () => {
      stopping = true;
      try { proc?.kill(); } catch (_e) { /* ignore */ }
    },
  };
}

/** Spawn the Vite dev server. */
function startClient() {
  const npm = isWin ? 'npm.cmd' : 'npm';
  const proc = spawn(npm, ['--prefix', 'client', 'run', 'dev'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin, // .cmd shims need a shell on Windows
  });
  pipe(proc, 'client', COLORS.client);
  return {
    stop: () => { try { proc.kill(); } catch (_e) { /* ignore */ } },
    proc,
  };
}

console.log(`${COLORS.dim}mc-panel dev launcher — Ctrl+C to stop${COLORS.reset}`);
const server = startServer();
const client = startClient();

const shutdown = () => {
  server.stop();
  client.stop();
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
client.proc.on('exit', (code) => {
  console.log(`${COLORS.dim}client exited (code ${code}) — stopping server${COLORS.reset}`);
  shutdown();
});
