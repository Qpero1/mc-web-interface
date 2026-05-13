/**
 * ConfigEditor tab — labeled form view + raw text fallback for server.properties.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Toggle, Input, Spinner, Badge } from '../ui';
import { RefreshIcon } from '../icons/index.jsx';
import { api } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

// Server keys that typically require a restart to take effect
const RESTART_KEYS = new Set([
  'level-name', 'level-seed', 'level-type', 'server-port', 'gamemode',
  'difficulty', 'online-mode', 'max-players', 'enforce-whitelist',
  'server-ip', 'rcon.port', 'rcon.password', 'enable-rcon',
  'view-distance', 'simulation-distance', 'spawn-protection',
]);

const BOOLEANS = new Set(['true', 'false']);

export function ConfigEditor() {
  const { selected } = useServers();
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [raw, setRaw] = useState('');
  const [rawMode, setRawMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await api(`/api/config/${selected.id}/properties`);
      setEntries(data.entries || []);
      setRaw(data.raw || '');
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => { if (selected) load(); }, [selected, load]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const body = rawMode ? { raw } : { entries };
      await api(`/api/config/${selected.id}/properties`, { method: 'PUT', body: JSON.stringify(body) });
      toast.success('server.properties saved');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  const pairEntries = useMemo(() => entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === 'pair'), [entries]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const setPair = (idx, value) => {
    setEntries((cur) => {
      const next = cur.slice();
      next[idx] = { ...next[idx], value };
      return next;
    });
  };

  const filtered = filter
    ? pairEntries.filter(({ e }) => e.key.toLowerCase().includes(filter.toLowerCase()))
    : pairEntries;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Config — {selected.name}</h1>
        <div className="flex items-center gap-2">
          <Toggle checked={rawMode} onChange={setRawMode} label="Raw text mode" />
          <Button variant="ghost" onClick={load}><RefreshIcon width="14" height="14" />Reload</Button>
          <Button onClick={save} loading={saving}>Save</Button>
        </div>
      </div>

      <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
        Some changes (port, gamemode, world, etc.) require restarting the server before they take effect.
      </div>

      {loading ? (
        <div className="p-10 flex justify-center"><Spinner /></div>
      ) : rawMode ? (
        <Card>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            className="w-full font-mono text-xs h-[60vh] rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-300/40"
          />
        </Card>
      ) : (
        <Card>
          <div className="mb-3">
            <Input placeholder="Filter properties…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.length === 0 ? (
              <div className="col-span-full text-center text-sm text-slate-500 py-6">
                No properties match.
              </div>
            ) : filtered.map(({ e, i }) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">{e.key}</label>
                  {RESTART_KEYS.has(e.key) ? <Badge variant="warning">restart</Badge> : null}
                </div>
                {BOOLEANS.has((e.value || '').trim()) ? (
                  <Toggle
                    checked={String(e.value).trim() === 'true'}
                    onChange={(v) => setPair(i, v ? 'true' : 'false')}
                    label={String(e.value).trim() === 'true' ? 'true' : 'false'}
                  />
                ) : (
                  <Input value={e.value} onChange={(ev) => setPair(i, ev.target.value)} />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
