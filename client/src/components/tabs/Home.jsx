/**
 * Home tab — list of servers with expandable details (graphs, lifecycle,
 * remove), a button to add a new server, and an activity log panel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Badge, Card, Modal, Input, Toggle, Tooltip } from '../ui';
import { ChevronDownIcon, ChevronRightIcon, PlayIcon, StopIcon, RestartIcon, TrashIcon, PlusIcon, RefreshIcon } from '../icons/index.jsx';
import { SparkChart } from '../SparkChart.jsx';
import { useServers } from '../../hooks/useServers.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useToast } from '../../hooks/useToast.js';
import { api } from '../../lib/api.js';

export function Home() {
  const { servers, refresh, addServer, removeServer, lifecycle } = useServers();
  const { socket } = useSocket();
  const toast = useToast();
  const [expanded, setExpanded] = useState({});
  const [addOpen, setAddOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);
  /** @type {[Record<string, {history:any[], rcon:any, latest:any}>, Function]} */
  const [stats, setStats] = useState({});
  const [activity, setActivity] = useState([]);
  const [removeLoading, setRemoveLoading] = useState(false);

  useEffect(() => {
    if (!socket) return undefined;
    const onUpdate = ({ serverId, point, rcon }) => {
      setStats((cur) => {
        const existing = cur[serverId] || { history: [], rcon: null, latest: null };
        const history = [...existing.history, point];
        const cutoff = Date.now() - 30 * 60 * 1000;
        while (history.length && history[0].ts < cutoff) history.shift();
        return { ...cur, [serverId]: { history, latest: point, rcon } };
      });
    };
    const onRcon = ({ serverId, rcon }) => {
      setStats((cur) => ({ ...cur, [serverId]: { ...(cur[serverId] || { history: [], latest: null }), rcon } }));
    };
    const onSnapshot = (snapshot) => {
      const next = {};
      for (const [k, v] of Object.entries(snapshot || {})) {
        next[k] = { history: [], latest: v.latest, rcon: v.rcon };
      }
      setStats((cur) => ({ ...next, ...cur }));
    };
    const onHistory = ({ serverId, history, rcon }) => {
      setStats((cur) => ({ ...cur, [serverId]: { history: history.slice(), latest: history.at(-1) || null, rcon } }));
    };
    socket.on('stats:update', onUpdate);
    socket.on('stats:rcon', onRcon);
    socket.on('stats:snapshot', onSnapshot);
    socket.on('stats:history', onHistory);
    socket.emit('stats:subscribe', {});
    return () => {
      socket.off('stats:update', onUpdate);
      socket.off('stats:rcon', onRcon);
      socket.off('stats:snapshot', onSnapshot);
      socket.off('stats:history', onHistory);
      socket.emit('stats:unsubscribe', {});
    };
  }, [socket]);

  const refreshActivity = async () => {
    try {
      const d = await api('/api/activity?limit=100');
      setActivity(d.entries || []);
    } catch (err) {
      toast.error(err.message);
    }
  };
  useEffect(() => { refreshActivity(); }, []);
  // refresh activity every 10s
  useEffect(() => {
    const t = setInterval(refreshActivity, 10000);
    return () => clearInterval(t);
  }, []);

  const toggleExpand = (id) => {
    setExpanded((cur) => ({ ...cur, [id]: !cur[id] }));
    if (!expanded[id] && socket) socket.emit('stats:subscribe', { serverId: id });
    else if (expanded[id] && socket) socket.emit('stats:unsubscribe', { serverId: id });
  };

  const onLifecycle = async (id, action) => {
    try {
      await lifecycle(id, action);
      toast.success(`Sent ${action} command`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onRemove = async () => {
    if (!confirmRemove) return;
    setRemoveLoading(true);
    try {
      await removeServer(confirmRemove);
      toast.success('Server removed');
      setConfirmRemove(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRemoveLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">All your Minecraft servers in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => { refresh(); refreshActivity(); }}>
            <RefreshIcon width="16" height="16" />
            Refresh
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon width="16" height="16" />
            Add server
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {servers.length === 0 ? (
            <Card><div className="p-8 text-center text-slate-500">
              <p className="mb-3">No servers yet.</p>
              <Button onClick={() => setAddOpen(true)}><PlusIcon width="16" height="16" />Add your first server</Button>
            </div></Card>
          ) : (
            servers.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                stats={stats[s.id]}
                expanded={!!expanded[s.id]}
                onToggle={() => toggleExpand(s.id)}
                onLifecycle={onLifecycle}
                onRemove={() => setConfirmRemove(s.id)}
              />
            ))
          )}
        </div>
        <Card header={<div className="text-sm font-semibold">Recent activity</div>}>
          <div className="max-h-[28rem] overflow-y-auto scrollbar-thin -mx-4">
            {activity.length === 0 ? (
              <div className="text-sm text-slate-500 px-4 py-6 text-center">No activity yet.</div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {activity.map((a, i) => (
                  <li key={i} className="px-4 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.type}</span>
                      <span className="text-xs text-slate-500">{new Date(a.ts).toLocaleTimeString()}</span>
                    </div>
                    {a.serverName ? <div className="text-xs text-slate-500">{a.serverName}</div> : null}
                    {a.details ? <div className="text-xs text-slate-600 dark:text-slate-300 break-words">{a.details}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <AddServerModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={async (payload) => {
        try {
          await addServer(payload);
          toast.success('Server added');
          setAddOpen(false);
        } catch (err) {
          toast.error(err.message);
        }
      }} />

      <Modal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title="Remove server?"
        onConfirm={onRemove}
        confirmText="Remove"
        confirmVariant="danger"
        loading={removeLoading}
      >
        <p className="text-sm">
          This removes the server from the panel. Files on the remote host are not deleted.
        </p>
      </Modal>
    </div>
  );
}

function ServerRow({ server, stats, expanded, onToggle, onLifecycle, onRemove }) {
  const latest = stats?.latest;
  const rcon = stats?.rcon;
  const online = !!latest?.online;
  const history = stats?.history || [];

  const players = history.map((p) => p.players);
  const cpu = history.map((p) => p.cpu);
  const ram = history.map((p) => Math.round(((p.ram || 0) / Math.max(1, p.maxRam || 1)) * 100));

  return (
    <Card padded={false}>
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDownIcon width="16" height="16" /> : <ChevronRightIcon width="16" height="16" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{server.name}</span>
            <Badge variant={online ? 'online' : 'offline'} dot>
              {online ? 'Online' : 'Offline'}
            </Badge>
            <Tooltip label={rcon?.lastSuccessAt ? `RCON last OK: ${new Date(rcon.lastSuccessAt).toLocaleTimeString()}` : (rcon?.lastError || 'RCON unreached')}>
              <span className={`inline-block h-2 w-2 rounded-full ${rcon?.connected ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-label="RCON status"></span>
            </Tooltip>
          </div>
          <div className="text-xs text-slate-500 truncate">
            {server.host}:{server.rcon.port} · {latest?.players ?? 0} player{latest?.players === 1 ? '' : 's'}
          </div>
        </div>
        <div className="hidden sm:block w-32"><SparkChart data={players} color="#1f8949" height={36} min={0} label="" /></div>
      </div>

      {expanded ? (
        <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padded><SparkChart label="Players (30m)" data={players} color="#1f8949" min={0} /></Card>
            <Card padded><SparkChart label="CPU %" data={cpu} color="#2563eb" min={0} max={100} suffix="%" /></Card>
            <Card padded><SparkChart label="RAM %" data={ram} color="#9333ea" min={0} max={100} suffix="%" /></Card>
          </div>
          <div className="mt-4 flex items-center flex-wrap gap-2">
            <Button onClick={() => onLifecycle(server.id, 'start')} disabled={online} variant="primary">
              <PlayIcon width="14" height="14" /> Start
            </Button>
            <Button onClick={() => onLifecycle(server.id, 'stop')} disabled={!online} variant="secondary">
              <StopIcon width="14" height="14" /> Stop
            </Button>
            <Button onClick={() => onLifecycle(server.id, 'restart')} disabled={!online} variant="secondary">
              <RestartIcon width="14" height="14" /> Restart
            </Button>
            <div className="flex-1" />
            <Button onClick={onRemove} variant="danger">
              <TrashIcon width="14" height="14" /> Remove
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function AddServerModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: '', host: '',
    rconPort: 25575, rconPassword: '',
    sshPort: 22, sshUser: 'minecraft', sshPassword: '', privateKeyPath: '',
    directory: '/home/minecraft/server',
    startCommand: 'systemctl --user start minecraft',
    stopCommand: 'systemctl --user stop minecraft',
    restartCommand: 'systemctl --user restart minecraft',
  });
  const [usePassword, setUsePassword] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target?.value ?? e }));

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        name: form.name,
        host: form.host,
        directory: form.directory,
        rcon: { port: Number(form.rconPort), password: form.rconPassword },
        ssh: {
          port: Number(form.sshPort),
          username: form.sshUser,
          password: usePassword ? form.sshPassword : '',
          privateKeyPath: usePassword ? '' : form.privateKeyPath,
        },
        startCommand: form.startCommand,
        stopCommand: form.stopCommand,
        restartCommand: form.restartCommand,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a new server"
      size="lg"
      onConfirm={submit}
      confirmText="Add server"
      loading={saving}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Display name" value={form.name} onChange={set('name')} placeholder="Survival" />
        <Input label="Tailscale IP / host" value={form.host} onChange={set('host')} placeholder="100.64.0.10" />
        <Input label="RCON port" type="number" value={form.rconPort} onChange={set('rconPort')} />
        <Input label="RCON password" type="password" value={form.rconPassword} onChange={set('rconPassword')} />
        <Input label="SSH port" type="number" value={form.sshPort} onChange={set('sshPort')} />
        <Input label="SSH user" value={form.sshUser} onChange={set('sshUser')} />
        <div className="sm:col-span-2">
          <Toggle checked={usePassword} onChange={setUsePassword} label="Authenticate SSH with password (off = private key)" />
        </div>
        {usePassword ? (
          <Input label="SSH password" type="password" value={form.sshPassword} onChange={set('sshPassword')} className="sm:col-span-2" />
        ) : (
          <Input label="Private key path on panel host" value={form.privateKeyPath} onChange={set('privateKeyPath')} placeholder="/home/you/.ssh/id_ed25519" className="sm:col-span-2" />
        )}
        <Input label="Server directory (remote)" value={form.directory} onChange={set('directory')} className="sm:col-span-2" />
        <Input label="Start command" value={form.startCommand} onChange={set('startCommand')} className="sm:col-span-2" />
        <Input label="Stop command" value={form.stopCommand} onChange={set('stopCommand')} className="sm:col-span-2" />
        <Input label="Restart command" value={form.restartCommand} onChange={set('restartCommand')} className="sm:col-span-2" />
      </div>
    </Modal>
  );
}
