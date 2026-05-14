/**
 * server/config.js
 * --------------------------------------------------------------------------
 * Loads and validates config.json (with environment overrides). Used at
 * startup; everything else takes the resolved config object as input.
 * --------------------------------------------------------------------------
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Load `config.json` from the project root, applying environment overrides.
 * Falls back to `config.example.json` only for non-secret panel defaults so
 * the panel still boots in dev — but auth fields must be set in config.json.
 *
 * @param {string} rootDir Project root.
 * @returns {Promise<object>} Resolved config.
 */
export async function loadConfig(rootDir) {
  const configPath = path.join(rootDir, 'config.json');
  const examplePath = path.join(rootDir, 'config.example.json');

  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // eslint-disable-next-line no-console
    console.warn('[mc-panel] config.json not found, falling back to config.example.json (auth will fail until you create config.json)');
    raw = await fs.readFile(examplePath, 'utf8');
  }
  const config = stripJsonComments(raw);

  // Environment overrides
  if (process.env.JWT_SECRET) config.panel.jwtSecret = process.env.JWT_SECRET;
  if (process.env.PORT) config.panel.port = parseInt(process.env.PORT, 10);
  if (process.env.HOST) config.panel.host = process.env.HOST;

  // Resolve paths against root
  config._rootDir = rootDir;
  config.activityLog.path = path.resolve(rootDir, config.activityLog.path);
  config.activityLog.jsonFallbackPath = path.resolve(rootDir, config.activityLog.jsonFallbackPath);
  config.backups.schedulesFile = path.resolve(rootDir, config.backups.schedulesFile);
  config.serversFile = path.resolve(rootDir, config.serversFile);

  return config;
}

/**
 * Parse JSON that allows "_comment*" keys (which we just ignore).
 * We strip nothing else — JSON5 isn't required.
 *
 * @param {string} text JSON text.
 * @returns {object}
 */
function stripJsonComments(text) {
  const parsed = JSON.parse(text);
  return removeCommentKeys(parsed);
}

function removeCommentKeys(value) {
  if (Array.isArray(value)) return value.map(removeCommentKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_comment')) continue;
      out[k] = removeCommentKeys(v);
    }
    return out;
  }
  return value;
}
