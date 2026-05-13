/**
 * Console tab — live log stream with color coding, autocomplete, autoscroll.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Toggle, Badge } from '../ui';
import { SendIcon, TerminalIcon } from '../icons/index.jsx';
import { useServers } from '../../hooks/useServers.js';
import { useSocket } from '../../hooks/useSocket.js';
import { useToast } from '../../hooks/useToast.js';
import { api } from '../../lib/api.js';
import { cx } from '../ui/cx.js';

const COMMANDS = [
  '/op', '/deop', '/kick', '/ban', '/ban-ip', '/pardon', '/pardon-ip',
  '/whitelist add', '/whitelist remove', '/whitelist list',
  '/time set day', '/time set night', '/time add',
  '/weather clear', '/weather rain', '/weather thunder',
  '/gamemode survival', '/gamemode creative', '/gamemode spectator', '/gamemode adventure',
  '/tp', '/give', '/kill', '/say', '/stop', '/restart', '/list', '/seed',
];

export function Console() {
  const { selected } = useServers();
  const { socket, status } = useSocket();
  const toast = useToast();
  const [lines, setLines] = useState([]);
  const [input, setInput] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!socket || !selected) return undefined;
    setLines([]);
    const onLine = ({ serverId, line, ts }) => {
      if (serverId !== selected.id) return;
      setLines((cur) => {
        const next = [...cur, { line, ts: ts || Date.now() }];
        if (next.length > 1000) next.splice(0, next.length - 1000);
        return next;
      });
    };
    const onReplay = ({ serverId, lines: replay }) => {
      if (serverId !== selected.id) return;
      setLines(replay.map((l) => ({ line: l, ts: Date.now() })));
    };
    const onError = ({ serverId, message }) => {
      if (serverId !== selected.id) return;
      toast.error(`Console: ${message}`);
    };
    socket.on('console:line', onLine);
    socket.on('console:replay', onReplay);
    socket.on('console:error', onError);
    socket.emit('console:subscribe', { serverId: selected.id });
    return () => {
      socket.off('console:line', onLine);
      socket.off('console:replay', onReplay);
      socket.off('console:error', onError);
      socket.emit('console:unsubscribe', { serverId: selected.id });
    };
  }, [socket, selected, toast]);

  useEffect(() => {
    if (!autoscroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [lines, autoscroll]);

  const suggestions = useMemo(() => {
    if (!input.startsWith('/')) return [];
    const lower = input.toLowerCase();
    return COMMANDS.filter((c) => c.startsWith(lower) && c !== input).slice(0, 8);
  }, [input]);

  if (!selected) return <div className="py-16 text-center text-slate-500">Choose a server first.</div>;

  const submit = async (raw) => {
    const cmd = (raw || input).trim();
    if (!cmd) return;
    try {
      await api(`/api/console/${selected.id}/send`, { method: 'POST', body: JSON.stringify({ command: cmd }) });
      setInput('');
      setShowSuggest(false);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><TerminalIcon />Console — {selected.name}</h1>
        <div className="flex items-center gap-2">
          <Badge variant={status === 'connected' ? 'online' : 'warning'} dot>{status === 'connected' ? 'Live' : status}</Badge>
          <Toggle checked={autoscroll} onChange={setAutoscroll} label="Auto-scroll" />
        </div>
      </div>

      <div
        ref={containerRef}
        className="font-mono text-xs bg-slate-950 text-slate-100 rounded-xl h-[60vh] overflow-y-auto scrollbar-thin border border-slate-800 p-3"
      >
        {lines.length === 0 ? (
          <div className="text-slate-500">Waiting for log output… (tailing logs/latest.log)</div>
        ) : lines.map((l, i) => (
          <div key={i} className={cx('console-line', colorFor(l.line))}>{l.line}</div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="relative flex items-center gap-2"
      >
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); setShowSuggest(true); setSuggestIdx(0); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 100)}
            onKeyDown={(e) => {
              if (showSuggest && suggestions.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestIdx((i) => (i + 1) % suggestions.length); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length); }
                else if (e.key === 'Tab' || (e.key === 'Enter' && input !== suggestions[suggestIdx])) {
                  if (e.key === 'Tab') { e.preventDefault(); setInput(suggestions[suggestIdx] + ' '); }
                }
              }
            }}
            placeholder="/say Hello world"
            className="w-full font-mono text-sm h-10 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-300/30"
          />
          {showSuggest && suggestions.length > 0 && (
            <ul className="absolute bottom-full mb-1 left-0 right-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-lg overflow-hidden z-10">
              {suggestions.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setInput(s + ' '); inputRef.current?.focus(); }}
                    className={cx('w-full text-left px-3 py-1.5 text-sm font-mono', i === suggestIdx ? 'bg-slate-100 dark:bg-slate-800' : '')}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="submit"><SendIcon width="14" height="14" />Send</Button>
      </form>
    </div>
  );
}

function colorFor(line) {
  if (/\bERROR\b|\bSEVERE\b|\bFATAL\b/i.test(line)) return 'text-rose-400';
  if (/\bWARN(?:ING)?\b/i.test(line)) return 'text-amber-300';
  if (/\bINFO\b/i.test(line)) return 'text-emerald-300';
  if (/^\[RCON\]/.test(line)) return 'text-sky-300';
  return 'text-slate-200';
}
