/**
 * agent/logger.js
 * --------------------------------------------------------------------------
 * Tiny structured logger. Lines are JSON with timestamp/level/msg/...keys.
 * Log level filtering is configurable. Stack traces are logged here and
 * never returned outward — outside callers only see structured errors.
 * --------------------------------------------------------------------------
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let active = LEVELS.info;

export function setLogLevel(level) {
  active = LEVELS[level] || LEVELS.info;
}

function write(level, msg, extra) {
  if (LEVELS[level] < active) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(extra || {}) });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (msg, extra) => write('debug', msg, extra),
  info:  (msg, extra) => write('info', msg, extra),
  warn:  (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => {
    const safe = { ...(extra || {}) };
    if (safe.error instanceof Error) {
      safe.stack = safe.error.stack;
      safe.error = safe.error.message;
    }
    write('error', msg, safe);
  },
};
