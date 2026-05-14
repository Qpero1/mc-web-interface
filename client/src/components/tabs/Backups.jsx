/**
 * Backups tab — per-world backups list, create/delete/download, auto-backup schedule.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Modal, Select, Spinner } from '../ui';
import { ArchiveIcon, DownloadIcon, TrashIcon, RefreshIcon, PlusIcon } from '../icons/index.jsx';
import { api, buildDownloadUrl } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

const INTERVALS = [
  { value: 'off', label: 'Off' },
  { value: '1h', label: 'Every 1 hour' },
  { value: '3h', label: 'Every 3 hours' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '24h', label: 'Every 24 hours' },
];

export function Backups() {
  const { selected } = useServers();
  const toast = useToast();
  const [backups, setBackups] = useState({});
  const [schedules, setSchedules] = useState({});
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [creating, setCreating] = useState(null);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const [bdata, wdata] = await Promise.all([
        api(`/api/backups/${selected.id}`),
        api(`/api/worlds/${selected.id}`),
      ]);
      setBackups(bdata.backups || {});
      setSchedules(bdata.schedules || {});
      setWorlds((wdata.worlds || []).map((w) => w.name));
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => { if (selected) load(); }, [selected, load]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const create = async (world) => {
    setCreating(world);
    try {
      await api(`/api/backups/${selected.id}/create`, { method: 'POST', body: JSON.stringify({ world }) });
      toast.success(`Backup of ${world} created`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally { setCreating(null); }
  };

  const setSchedule = async (world, interval) => {
    try {
      await api(`/api/backups/${selected.id}/schedule`, { method: 'POST', body: JSON.stringify({ world, interval }) });
      toast.success(`Schedule for ${world}: ${interval}`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await api(`/api/backups/${selected.id}?world=${encodeURIComponent(confirmDelete.world)}&name=${encodeURIComponent(confirmDelete.name)}`, { method: 'DELETE' });
      toast.success('Backup deleted');
      setConfirmDelete(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const download = (world, name) => {
    window.location.href = buildDownloadUrl(`/api/backups/${selected.id}/download?world=${encodeURIComponent(world)}&name=${encodeURIComponent(name)}`);
  };

  // Combine worlds from /worlds and folders that already have backups
  const worldList = Array.from(new Set([...(worlds || []), ...Object.keys(backups)])).sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Backups — {selected.name}</h1>
        <Button variant="ghost" onClick={load}><RefreshIcon width="14" height="14" />Reload</Button>
      </div>

      {loading ? <div className="p-10 flex justify-center"><Spinner /></div> : null}

      {!loading && worldList.length === 0 && (
        <Card><div className="p-8 text-center text-slate-500">No worlds detected. Worlds appear here once they exist in the server directory.</div></Card>
      )}

      <div className="space-y-4">
        {worldList.map((world) => (
          <Card
            key={world}
            header={
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="font-semibold flex items-center gap-2"><ArchiveIcon width="16" height="16" />{world}</div>
                <div className="flex items-center gap-2">
                  <Select
                    value={schedules[world] || 'off'}
                    onChange={(e) => setSchedule(world, e.target.value)}
                    options={INTERVALS}
                    className="w-44"
                  />
                  <Button size="sm" onClick={() => create(world)} loading={creating === world}>
                    <PlusIcon width="14" height="14" />Create backup
                  </Button>
                </div>
              </div>
            }
            padded={false}
          >
            {!(backups[world] && backups[world].length) ? (
              <div className="px-4 py-6 text-sm text-slate-500 text-center">No backups yet for this world.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {backups[world].map((b) => (
                  <li key={b.name} className="px-4 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm truncate">{b.name}</div>
                      <div className="text-xs text-slate-500">{new Date(b.modifyTime).toLocaleString()} · {formatBytes(b.size)}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => download(world, b.name)} title="Download"><DownloadIcon width="14" height="14" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete({ world, name: b.name })} title="Delete"><TrashIcon width="14" height="14" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete backup?" confirmVariant="danger" confirmText="Delete" onConfirm={remove}>
        <p className="text-sm">Delete backup <b>{confirmDelete?.name}</b>?</p>
      </Modal>
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}
