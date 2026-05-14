import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * ServerContext — keeps the list of configured servers and the currently
 * selected one. Exposes refresh + selection helpers.
 */
const ServerContext = createContext(null);

export function ServerProvider({ children }) {
  const [servers, setServers] = useState([]);
  const [selectedId, setSelectedIdState] = useState(() => {
    try { return localStorage.getItem('mcpanel.selectedServer') || null; } catch (_e) { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const setSelectedId = useCallback((id) => {
    setSelectedIdState(id);
    try {
      if (id) localStorage.setItem('mcpanel.selectedServer', id);
      else localStorage.removeItem('mcpanel.selectedServer');
    } catch (_e) { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/api/servers');
      setServers(data.servers || []);
      // If selected server vanished, pick first
      if (selectedId && !data.servers?.find((s) => s.id === selectedId)) {
        setSelectedId(data.servers?.[0]?.id || null);
      } else if (!selectedId && data.servers?.length) {
        setSelectedId(data.servers[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load servers');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = useMemo(
    () => servers.find((s) => s.id === selectedId) || null,
    [servers, selectedId]
  );

  const value = useMemo(() => ({
    servers, selected, selectedId, setSelectedId, refresh, loading, error,
  }), [servers, selected, selectedId, setSelectedId, refresh, loading, error]);

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>;
}

export function useServerContext() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServerContext must be inside ServerProvider');
  return ctx;
}
