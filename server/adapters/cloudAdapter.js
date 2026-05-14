/**
 * server/adapters/cloudAdapter.js
 * --------------------------------------------------------------------------
 * Cloud transport adapter — STUB for Phase 1-3.
 *
 * In a later phase this is where the panel/agent will connect to the cloud
 * control plane to receive remote jobs and forward events. For now it does
 * nothing; importing it has no side effects.
 * --------------------------------------------------------------------------
 */

/**
 * Initialize the cloud adapter. No-op for now.
 * @param {object} _ctx { registry, services }
 * @returns {Promise<{connected:false, reason:string}>}
 */
export async function registerCloudAdapter(_ctx) {
  return { connected: false, reason: 'Cloud features are not enabled in this phase.' };
}
