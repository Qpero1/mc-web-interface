import { useCallback } from 'react';
import { api } from '../lib/api.js';
import { useServerContext } from '../context/ServerContext.jsx';

/**
 * useServers — convenience hook combining ServerContext state with CRUD helpers.
 */
export function useServers() {
  const ctx = useServerContext();

  const addServer = useCallback(async (payload) => {
    const data = await api('/api/servers', { method: 'POST', body: JSON.stringify(payload) });
    await ctx.refresh();
    return data.server;
  }, [ctx]);

  const updateServer = useCallback(async (id, payload) => {
    const data = await api(`/api/servers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    await ctx.refresh();
    return data.server;
  }, [ctx]);

  const removeServer = useCallback(async (id) => {
    await api(`/api/servers/${id}`, { method: 'DELETE' });
    await ctx.refresh();
  }, [ctx]);

  const lifecycle = useCallback(async (id, action) => {
    return api(`/api/servers/${id}/lifecycle/${action}`, { method: 'POST' });
  }, []);

  return { ...ctx, addServer, updateServer, removeServer, lifecycle };
}
