/**
 * Files tab — SFTP file browser. Navigate, upload, download, delete, rename.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Modal, Input, Breadcrumb, Spinner } from '../ui';
import { FolderIcon, UploadIcon, DownloadIcon, TrashIcon, PencilIcon, PlusIcon, RefreshIcon } from '../icons/index.jsx';
import { api, buildDownloadUrl } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

export function Files() {
  const { selected } = useServers();
  const toast = useToast();
  const [cwd, setCwd] = useState('/');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirValue, setMkdirValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (p) => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await api(`/api/files/${selected.id}/list?path=${encodeURIComponent(p)}`);
      setEntries(data.entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      }));
      setCwd(p);
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => {
    if (selected) load('/');
  }, [selected, load]);

  const crumbs = useMemo(() => {
    const parts = cwd.split('/').filter(Boolean);
    const items = [{ label: 'root', onClick: () => load('/') }];
    parts.forEach((p, i) => {
      const path = '/' + parts.slice(0, i + 1).join('/');
      items.push({ label: p, onClick: () => load(path) });
    });
    return items;
  }, [cwd, load]);

  if (!selected) return <SelectServerEmpty />;

  const onEntryClick = (e) => {
    if (e.type === 'directory') {
      const next = cwd === '/' ? `/${e.name}` : `${cwd}/${e.name}`;
      load(next);
    }
  };

  const onDownload = (name) => {
    const target = cwd === '/' ? `/${name}` : `${cwd}/${name}`;
    const url = buildDownloadUrl(`/api/files/${selected.id}/download?path=${encodeURIComponent(target)}`);
    window.location.href = url;
  };

  const onUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const f of files) {
        const body = new FormData();
        body.append('file', f);
        body.append('path', cwd);
        await api(`/api/files/${selected.id}/upload`, { method: 'POST', body });
      }
      toast.success(`Uploaded ${files.length} file(s)`);
      await load(cwd);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onRename = async () => {
    if (!renameTarget || !renameValue) return;
    const from = cwd === '/' ? `/${renameTarget.name}` : `${cwd}/${renameTarget.name}`;
    const to = cwd === '/' ? `/${renameValue}` : `${cwd}/${renameValue}`;
    try {
      await api(`/api/files/${selected.id}/rename`, { method: 'POST', body: JSON.stringify({ from, to }) });
      toast.success('Renamed');
      setRenameTarget(null);
      setRenameValue('');
      await load(cwd);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onDelete = async () => {
    if (!deleteTarget) return;
    const target = cwd === '/' ? `/${deleteTarget.name}` : `${cwd}/${deleteTarget.name}`;
    try {
      await api(`/api/files/${selected.id}?path=${encodeURIComponent(target)}`, { method: 'DELETE' });
      toast.success('Deleted');
      setDeleteTarget(null);
      await load(cwd);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onMkdir = async () => {
    if (!mkdirValue) return;
    const target = cwd === '/' ? `/${mkdirValue}` : `${cwd}/${mkdirValue}`;
    try {
      await api(`/api/files/${selected.id}/mkdir`, { method: 'POST', body: JSON.stringify({ path: target }) });
      toast.success('Folder created');
      setMkdirOpen(false);
      setMkdirValue('');
      await load(cwd);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Files — {selected.name}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => load(cwd)}><RefreshIcon width="14" height="14" /> Reload</Button>
          <Button variant="secondary" onClick={() => setMkdirOpen(true)}><PlusIcon width="14" height="14" /> New folder</Button>
          <Button onClick={() => fileInputRef.current?.click()} loading={uploading}>
            <UploadIcon width="14" height="14" /> Upload
          </Button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onUpload(Array.from(e.target.files || []))} />
        </div>
      </div>
      <Card padded={false}>
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Breadcrumb items={crumbs} />
        </div>
        {loading ? (
          <div className="p-12 flex justify-center"><Spinner /></div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">This folder is empty.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {entries.map((e) => (
              <li key={e.name} className="px-4 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <button type="button" className="flex items-center gap-2 truncate text-left" onClick={() => onEntryClick(e)}>
                    {e.type === 'directory' ? <FolderIcon width="16" height="16" /> : <span className="w-4 inline-block text-slate-400">·</span>}
                    <span className="truncate">{e.name}</span>
                  </button>
                </div>
                <div className="text-xs text-slate-500 w-24 text-right tabular-nums">{e.type === 'directory' ? '—' : formatBytes(e.size)}</div>
                <div className="flex items-center gap-1">
                  {e.type !== 'directory' && (
                    <Button size="sm" variant="ghost" onClick={() => onDownload(e.name)} title="Download"><DownloadIcon width="14" height="14" /></Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => { setRenameTarget(e); setRenameValue(e.name); }} title="Rename"><PencilIcon width="14" height="14" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(e)} title="Delete"><TrashIcon width="14" height="14" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename" onConfirm={onRename} confirmText="Rename">
        <Input label="New name" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
      </Modal>
      <Modal open={mkdirOpen} onClose={() => setMkdirOpen(false)} title="New folder" onConfirm={onMkdir} confirmText="Create">
        <Input label="Folder name" value={mkdirValue} onChange={(e) => setMkdirValue(e.target.value)} autoFocus />
      </Modal>
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete?" confirmVariant="danger" confirmText="Delete" onConfirm={onDelete}>
        <p className="text-sm">Delete <b>{deleteTarget?.name}</b>?{deleteTarget?.type === 'directory' ? ' This also removes everything inside it.' : ''}</p>
      </Modal>
    </div>
  );
}

function SelectServerEmpty() {
  return (
    <div className="py-16 text-center text-slate-500">
      Choose a server from the sidebar to continue.
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}
