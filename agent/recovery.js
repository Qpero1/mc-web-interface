/**
 * agent/recovery.js
 * --------------------------------------------------------------------------
 * Agent restart reconciliation. Called once during startup AFTER stateManager
 * has loaded its persisted file. For each server marked online/starting:
 *   - If its recorded PID is still alive: re-attach log streaming and start
 *     RCON polling. State is updated to 'online'.
 *   - If the PID is dead: mark the server as 'crashed' with no recent log.
 * Never spawns new processes; recovery is observation-only.
 * --------------------------------------------------------------------------
 */
import { logger } from './logger.js';

/**
 * Run reconciliation.
 * @param {object} deps { config, stateManager, processManager, logStreamer, rcon }
 */
export async function reconcile({ config, stateManager, logStreamer, rcon, agentConfig }) {
  const summary = await stateManager.reconcile(config.servers);
  for (const id of summary.reattached) {
    const server = config.servers.find((s) => s.id === id);
    if (!server) continue;
    // Start watching log file again (no callback — just to populate backlog)
    logStreamer.subscribe(server, () => {})();
    // Begin RCON readiness polling (won't block)
    rcon.waitForReady(server, agentConfig.rconReadyTimeoutMs).catch(() => {});
  }
  logger.info('recovery.done', summary);
  return summary;
}
