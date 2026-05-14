/**
 * Mods tab — browse, upload (drag & drop), toggle, delete mod jars.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input, Modal, Toggle, Badge, Spinner } from '../ui';
import { UploadIcon, TrashIcon, RefreshIcon, SearchIcon } from '../icons/index.jsx';
import { api } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

export function Mods() {
  const { selected } = useServers();
  const toast = useToast();
  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await api(`/api/mods/${selected.id}`);
      setMods(data.mods);
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => { if (selected) load(); }, [selected, load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return mods;
    return mods.filter((m) => m.name.toLowerCase().includes(term));
  }, [mods, q]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const upload = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const body = new FormData();
      for (const f of files) body.append('files', f);
      await api(`/api/mods/${selected.id}/upload`, { method: 'POST', body });
      toast.success(`Uploaded ${files.length} mod(s)`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onToggle = async (mod, enabled) => {
    try {
      await api(`/api/mods/${selected.id}/toggle`, {
        method: 'POST', body: JSON.stringify({ name: mod.name, enabled }),
      });
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api(`/api/mods/${selected.id}?name=${encodeURIComponent(confirmDelete.name)}`, { method: 'DELETE' });
      toast.success('Mod deleted');
      setConfirmDelete(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Mods — {selected.name}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={load}><RefreshIcon width="14" height="14" />Reload</Button>
          <Button onClick={() => fileInputRef.current?.click()} loading={uploading}><UploadIcon width="14" height="14" />Upload</Button>
          <input ref={fileInputRef} type="file" multiple accept=".jar,.jar.disabled" className="hidden" onChange={(e) => upload(Array.from(e.target.files || []))} />
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          upload(Array.from(e.dataTransfer.files || []));
        }}
        className={`rounded-xl border-2 border-dashed p-3 transition-colors ${dragOver ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/20' : 'border-slate-200 dark:border-slate-800'}`}
      >
        <div className="flex items-center gap-2 mb-3">
          <Input leftSlot={<SearchIcon width="14" height="14" />} placeholder="Search mods…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Drop .jar files here, or click Upload.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((m) => (
              <li key={m.name} className="px-2 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-slate-500">{formatBytes(m.size)}</div>
                </div>
                <Badge variant={m.enabled ? 'enabled' : 'disabled'} dot>{m.enabled ? 'Enabled' : 'Disabled'}</Badge>
                <Toggle checked={m.enabled} onChange={(v) => onToggle(m, v)} />
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(m)} title="Delete"><TrashIcon width="14" height="14" /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete mod?" confirmVariant="danger" confirmText="Delete" onConfirm={onDelete}>
        <p className="text-sm">Delete <b>{confirmDelete?.name}</b>?</p>
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
