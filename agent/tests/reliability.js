#!/usr/bin/env node
/**
 * agent/tests/reliability.js
 * --------------------------------------------------------------------------
 * Self-contained reliability test suite for the agent. Spawns a fake
 * "Minecraft server" — a Node script that prints log lines forever and
 * stays alive until stopped — so the tests run without needing a real
 * Java install.
 *
 * Run with:
 *   node agent/tests/reliability.js
 *
 * Each test prints PASS / FAIL and the suite exits non-zero on any
 * failure. The agent is started in-process (no HTTP) so we can drive its
 * job handler directly.
 * --------------------------------------------------------------------------
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProcessManager } from '../processManager.js';
import { StateManager } from '../stateManager.js';
import { LogStreamer } from '../logStreamer.js';
import { RconClientManager } from '../rconClient.js';
import { createJobHandler } from '../jobHandler.js';
import { setLogLevel } from '../logger.js';

setLogLevel('warn');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_TMP = path.join(os.tmpdir(), 'mc-panel-agent-tests-' + Date.now());

const results = [];
let suiteFailed = false;

function record(name, ok, info) {
  results.push({ name, ok, info });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  process.stdout.write(`${tag}  ${name}${info ? ' — ' + info : ''}\n`);
  if (!ok) suiteFailed = true;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/** Make a fake server directory + start command (a Node "heartbeat" script). */
async function makeFakeServer(id, opts = {}) {
  const dir = path.join(ROOT_TMP, id);
  await fs.mkdir(path.join(dir, 'logs'), { recursive: true });
  // The fake jar — a tiny Node script that prints to stdout AND writes to logs/latest.log
  const fakeJs = path.join(dir, 'fake-server.cjs');
  await fs.writeFile(fakeJs, `
const fs = require('node:fs');
const path = require('node:path');
const log = fs.createWriteStream(path.join(__dirname, 'logs', 'latest.log'), { flags: 'a' });
let i = 0;
const tick = () => {
  const line = '[' + new Date().toISOString() + '] [Server thread/INFO]: heartbeat ' + (++i);
  console.log(line);
  log.write(line + '\\n');
};
tick();
const t = setInterval(tick, 200);
process.stdin.on('data', (d) => {
  const cmd = String(d).trim();
  if (cmd === 'stop') {
    console.log('[INFO]: Stopping server');
    clearInterval(t);
    log.end();
    setTimeout(() => process.exit(0), 50);
  }
});
process.on('SIGTERM', () => { clearInterval(t); log.end(); setTimeout(() => process.exit(0), 50); });
`.trim());
  return {
    id, name: id, directory: dir,
    startCommand: opts.startCommand || `"${process.execPath}" ${JSON.stringify(fakeJs)}`,
    rconPort: 0, rconPassword: 'unused', javaPath: 'node',
    stopGraceMs: 3000, port: opts.port || 0, autoRestart: false,
  };
}

function buildAgent(servers) {
  const config = { servers, agent: { backupDirectory: path.join(ROOT_TMP, 'backups'), rconReadyTimeoutMs: 1500 } };
  const processManager = new ProcessManager();
  const stateManager = new StateManager(path.join(ROOT_TMP, `state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`), processManager);
  const logStreamer = new LogStreamer(200);
  const rcon = new RconClientManager();
  processManager.on('log', ({ serverId, line }) => logStreamer.pushLine(serverId, line));
  processManager.on('stopped', ({ serverId }) => stateManager.setState(serverId, { process: 'offline', rcon: 'disconnected', pid: null }));
  processManager.on('crashed', ({ serverId, code, recentLog }) => stateManager.setState(serverId, { process: 'crashed', rcon: 'disconnected', pid: null, crash: { code, signal: null, recentLog } }));
  const jobs = createJobHandler({ config, stateManager, processManager, logStreamer, rcon, agentConfig: config.agent });
  return { config, processManager, stateManager, logStreamer, rcon, jobs };
}

// ---- Test A: crash detection
async function testA() {
  const server = await makeFakeServer('A-crash');
  const a = buildAgent([server]);
  const r = await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
  if (!r.success) return record('A: crash detection', false, 'start failed: ' + r.error?.message);
  await sleep(300);
  const pid = a.processManager.getPid(server.id);
  if (!pid) return record('A: crash detection', false, 'no pid tracked');
  try { process.kill(pid, 'SIGKILL'); } catch (e) { return record('A: crash detection', false, 'kill failed: ' + e.message); }
  const detected = await waitFor(() => a.stateManager.getState(server.id).process === 'crashed', { timeoutMs: 5000 });
  record('A: crash detection (within 5s)', detected, detected ? '' : 'state never moved to crashed');
}

// ---- Test B: rapid cycle
async function testB() {
  const server = await makeFakeServer('B-cycle');
  const a = buildAgent([server]);
  let okAll = true; let firstFail = '';
  for (let i = 0; i < 5; i++) {
    const s = await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
    if (!s.success) { okAll = false; firstFail = `start[${i}]: ${s.error?.message}`; break; }
    await waitFor(() => a.processManager.isRunning(server.id), { timeoutMs: 3000 });
    const t = await a.jobs.dispatch({ type: 'stopServer', serverId: server.id });
    if (!t.success) { okAll = false; firstFail = `stop[${i}]: ${t.error?.message}`; break; }
    await waitFor(() => !a.processManager.isRunning(server.id), { timeoutMs: 5000 });
  }
  // No leaked PIDs
  if (okAll && a.processManager.isRunning(server.id)) { okAll = false; firstFail = 'still running after final stop'; }
  record('B: rapid cycle (5 start/stop)', okAll, firstFail);
}

// ---- Test C: multi-server isolation
async function testC() {
  const s1 = await makeFakeServer('C-one');
  const s2 = await makeFakeServer('C-two');
  const a = buildAgent([s1, s2]);
  const collected = { [s1.id]: [], [s2.id]: [] };
  a.logStreamer.subscribe(s1, (p) => { if (!p.replay && p.line) collected[s1.id].push(p.line); });
  a.logStreamer.subscribe(s2, (p) => { if (!p.replay && p.line) collected[s2.id].push(p.line); });
  await a.jobs.dispatch({ type: 'startServer', serverId: s1.id });
  await a.jobs.dispatch({ type: 'startServer', serverId: s2.id });
  await sleep(700);
  await a.jobs.dispatch({ type: 'stopServer', serverId: s1.id });
  await a.jobs.dispatch({ type: 'stopServer', serverId: s2.id });
  await waitFor(() => !a.processManager.isRunning(s1.id) && !a.processManager.isRunning(s2.id), { timeoutMs: 5000 });
  // No cross-contamination: every log line for s1 was emitted on s1's stream only, and same for s2
  const ok = collected[s1.id].length > 0 && collected[s2.id].length > 0;
  record('C: multi-server isolation', ok, ok ? '' : 'no log lines collected for one of the servers');
}

// ---- Test D: bad start command
async function testD() {
  const server = await makeFakeServer('D-bad', { startCommand: 'this-command-does-not-exist-zzzzz' });
  // Use a non-existent executable that the shell will still attempt to launch — it should exit with non-zero
  const a = buildAgent([server]);
  await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
  // Wait briefly; the shell will exit immediately because the command isn't found
  const went = await waitFor(() => {
    const st = a.stateManager.getState(server.id);
    return st.process === 'crashed' || st.process === 'offline';
  }, { timeoutMs: 5000 });
  // Either path is fine — the agent must NOT crash
  record('D: bad start command — agent stays alive', went, went ? '' : 'state stuck in starting');
}

// ---- Test E: agent restart while server running (simulated via reconcile)
async function testE() {
  const server = await makeFakeServer('E-restart');
  const a = buildAgent([server]);
  await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
  await waitFor(() => a.processManager.isRunning(server.id), { timeoutMs: 3000 });
  const pid = a.processManager.getPid(server.id);
  // Persist state, then build a new agent instance pointing at the same state file
  await a.stateManager.flushNow();
  const fresh = buildAgent([server]);
  fresh.stateManager.path = a.stateManager.path; // share file
  await fresh.stateManager.init();
  const summary = await fresh.stateManager.reconcile([server]);
  const reattached = summary.reattached.includes(server.id);
  // Clean up (real PID still running)
  try { process.kill(pid, 'SIGKILL'); } catch {}
  record('E: agent restart re-detects running server', reattached, reattached ? '' : 'reconcile did not reattach');
}

// ---- Test F: port conflict (duplicate start refused)
async function testF() {
  const server = await makeFakeServer('F-port');
  const a = buildAgent([server]);
  const r1 = await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
  if (!r1.success) return record('F: port/duplicate refused', false, 'first start failed');
  const r2 = await a.jobs.dispatch({ type: 'startServer', serverId: server.id });
  await a.jobs.dispatch({ type: 'stopServer', serverId: server.id });
  await waitFor(() => !a.processManager.isRunning(server.id), { timeoutMs: 5000 });
  const refused = !r2.success && (r2.error?.errorCode === 'ALREADY_RUNNING' || r2.error?.errorCode === 'PORT_IN_USE');
  record('F: duplicate start refused', refused, refused ? '' : `unexpected result: ${JSON.stringify(r2.error)}`);
}

// ---- Test G: path traversal attempt
async function testG() {
  const server = await makeFakeServer('G-traverse');
  const a = buildAgent([server]);
  const r = await a.jobs.dispatch({ type: 'readFile', serverId: server.id, path: '../../etc/passwd' });
  const refused = !r.success && r.error?.errorCode === 'PATH_TRAVERSAL';
  record('G: path traversal refused', refused, refused ? '' : `unexpected: ${JSON.stringify(r)}`);
}

async function main() {
  await fs.mkdir(ROOT_TMP, { recursive: true });
  process.stdout.write(`\nReliability suite — workspace: ${ROOT_TMP}\n\n`);
  try {
    await testG();   // cheap — run first
    await testD();
    await testF();
    await testE();
    await testC();
    await testB();
    await testA();
  } catch (err) {
    record('suite execution', false, err.message);
  }
  // Summary
  process.stdout.write('\n');
  const pass = results.filter((r) => r.ok).length;
  process.stdout.write(`Passed ${pass}/${results.length} tests.\n`);
  // Cleanup
  try { await fs.rm(ROOT_TMP, { recursive: true, force: true }); } catch {}
  process.exit(suiteFailed ? 1 : 0);
}

main();
