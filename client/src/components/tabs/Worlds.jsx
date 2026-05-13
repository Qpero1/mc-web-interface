/**
 * Worlds tab — list, upload (zip), delete, set active, download as zip.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Badge, Modal, Spinner } from '../ui';
import { UploadIcon, DownloadIcon, TrashIcon, RefreshIcon, GlobeIcon } from '../icons/index.jsx';
import { api, buildDownloadUrl } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

export function Worlds() {
  const { selected } = useServers();
  const toast = useToast();
  const [worlds, setWorlds] = useState([]);
  const [activeWorld, setActiveWorld] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmActivate, setConfirmActivate] = useState(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await api(`/api/worlds/${selected.id}`);
      setWorlds(data.worlds);
      setActiveWorld(data.activeWorld);
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => { if (selected) load(); }, [selected, load]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const onUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api(`/api/worlds/${selected.id}/upload`, { method: 'POST', body });
      toast.success('World uploaded');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onActivate = async () => {
    if (!confirmActivate) return;
    try {
      await api(`/api/worlds/${selected.id}/active`, { method: 'POST', body: JSON.stringify({ name: confirmActivate.name }) });
      toast.success('Active world updated. Restart the server for it to take effect.');
      setConfirmActivate(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api(`/api/worlds/${selected.id}?name=${encodeURIComponent(confirmDelete.name)}`, { method: 'DELETE' });
      toast.success('World deleted');
      setConfirmDelete(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const download = (name) => {
    window.location.href = buildDownloadUrl(`/api/worlds/${selected.id}/download?name=${encodeURIComponent(name)}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Worlds — {selected.name}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={load}><RefreshIcon width="14" height="14" />Reload</Button>
          <Button onClick={() => fileInputRef.current?.click()} loading={uploading}>
            <UploadIcon width="14" height="14" />Upload zip
          </Button>
          <input ref={fileInputRef} type="file" accept=".zip" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
        </div>
      </div>

      <Card padded={false}>
        {loading ? (
          <div className="p-10 flex justify-center"><Spinner /></div>
        ) : worlds.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No worlds found in this server directory.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {worlds.map((w) => (
              <li key={w.name} className="px-4 py-3 flex items-center gap-3">
                <GlobeIcon width="18" height="18" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{w.name}</div>
                  <div className="text-xs text-slate-500">Modified {new Date(w.modifyTime).toLocaleString()}</div>
                </div>
                {w.active ? <Badge variant="online" dot>Active</Badge> : <Badge variant="neutral">Inactive</Badge>}
                <Button size="sm" variant="ghost" onClick={() => download(w.name)} title="Download zip"><DownloadIcon width="14" height="14" /></Button>
                {!w.active && <Button size="sm" variant="secondary" onClick={() => setConfirmActivate(w)}>Activate</Button>}
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(w)} title="Delete"><TrashIcon width="14" height="14" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!confirmActivate} onClose={() => setConfirmActivate(null)} title="Activate world?" confirmText="Activate" onConfirm={onActivate}>
        <p className="text-sm">Set <b>{confirmActivate?.name}</b> as the active world (updates <code>level-name</code> in server.properties). You must restart the server for the change to take effect.</p>
      </Modal>
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete world?" confirmVariant="danger" confirmText="Delete" onConfirm={onDelete}>
        <p className="text-sm">Permanently delete the world folder <b>{confirmDelete?.name}</b> from the remote host?</p>
      </Modal>
    </div>
  );
}
