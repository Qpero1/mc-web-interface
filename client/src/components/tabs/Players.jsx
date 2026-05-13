/**
 * Players tab — roster table with whitelist/ban/kick actions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Badge, Modal, Select, Input, Spinner } from '../ui';
import { RefreshIcon, SearchIcon } from '../icons/index.jsx';
import { api } from '../../lib/api.js';
import { useServers } from '../../hooks/useServers.js';
import { useToast } from '../../hooks/useToast.js';

export function Players() {
  const { selected } = useServers();
  const toast = useToast();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [banTarget, setBanTarget] = useState(null);
  const [banMode, setBanMode] = useState('name');
  const [banReason, setBanReason] = useState('');
  const [kickTarget, setKickTarget] = useState(null);
  const [kickReason, setKickReason] = useState('');

  const load = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const data = await api(`/api/players/${selected.id}`);
      setPlayers(data.players);
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  }, [selected, toast]);

  useEffect(() => { if (selected) load(); }, [selected, load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return players;
    return players.filter((p) => (p.name || '').toLowerCase().includes(term) || (p.uuid || '').toLowerCase().includes(term));
  }, [players, q]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const onWhitelist = async (p, action) => {
    try {
      await api(`/api/players/${selected.id}/whitelist`, { method: 'POST', body: JSON.stringify({ name: p.name, action }) });
      toast.success(`Whitelist ${action === 'remove' ? 'removed' : 'added'}`);
      await load();
    } catch (err) { toast.error(err.message); }
  };

  const onBan = async () => {
    if (!banTarget) return;
    try {
      await api(`/api/players/${selected.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ name: banTarget.name, ip: banTarget.ip, mode: banMode, reason: banReason }),
      });
      toast.success('Ban issued');
      setBanTarget(null);
      setBanReason('');
      await load();
    } catch (err) { toast.error(err.message); }
  };

  const onPardon = async (p) => {
    try {
      await api(`/api/players/${selected.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ name: p.name, ip: p.ip, mode: p.ipBanned ? 'pardon-ip' : 'pardon' }),
      });
      toast.success('Pardon issued');
      await load();
    } catch (err) { toast.error(err.message); }
  };

  const onKick = async () => {
    if (!kickTarget) return;
    try {
      await api(`/api/players/${selected.id}/kick`, { method: 'POST', body: JSON.stringify({ name: kickTarget.name, reason: kickReason }) });
      toast.success('Kicked');
      setKickTarget(null);
      setKickReason('');
      await load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Players — {selected.name}</h1>
        <Button variant="ghost" onClick={load}><RefreshIcon width="14" height="14" />Reload</Button>
      </div>

      <Card padded={false}>
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 flex-wrap">
          <Input leftSlot={<SearchIcon width="14" height="14" />} placeholder="Search by name or UUID…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
          <span className="text-xs text-amber-600 dark:text-amber-300">⚠ IP addresses are private data — only share with people you trust.</span>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">UUID</th>
                  <th className="px-4 py-2 font-medium">IP</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan="5" className="px-4 py-6 text-center text-slate-500">No players found.</td></tr>}
                {filtered.map((p) => (
                  <tr key={p.uuid || p.name} className="border-b border-slate-100 dark:border-slate-800/70">
                    <td className="px-4 py-2 font-medium">{p.name || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500 truncate max-w-[18ch]">{p.uuid || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{p.ip || '—'}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={p.online ? 'online' : 'offline'} dot>{p.online ? 'Online' : 'Offline'}</Badge>
                        {p.whitelisted && <Badge variant="info">Whitelisted</Badge>}
                        {(p.banned || p.ipBanned) && <Badge variant="error">{p.ipBanned ? 'IP banned' : 'Banned'}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {p.whitelisted ? (
                          <Button size="sm" variant="ghost" onClick={() => onWhitelist(p, 'remove')}>Unwhitelist</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => onWhitelist(p, 'add')}>Whitelist</Button>
                        )}
                        {p.online && <Button size="sm" variant="secondary" onClick={() => setKickTarget(p)}>Kick</Button>}
                        {(p.banned || p.ipBanned) ? (
                          <Button size="sm" variant="ghost" onClick={() => onPardon(p)}>Pardon</Button>
                        ) : (
                          <Button size="sm" variant="danger" onClick={() => { setBanTarget(p); setBanMode('name'); }}>Ban</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!banTarget} onClose={() => setBanTarget(null)} title={`Ban ${banTarget?.name || ''}?`} confirmVariant="danger" confirmText="Ban" onConfirm={onBan}>
        <div className="space-y-3">
          <Select label="Ban type" value={banMode} onChange={(e) => setBanMode(e.target.value)} options={[
            { value: 'name', label: 'Ban by name' },
            { value: 'ip', label: `Ban by IP${banTarget?.ip ? ` (${banTarget.ip})` : ''}` },
          ]} />
          <Input label="Reason (optional)" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
        </div>
      </Modal>

      <Modal open={!!kickTarget} onClose={() => setKickTarget(null)} title={`Kick ${kickTarget?.name || ''}?`} confirmText="Kick" onConfirm={onKick}>
        <Input label="Reason (optional)" value={kickReason} onChange={(e) => setKickReason(e.target.value)} />
      </Modal>
    </div>
  );
}
