/**
 * Left sidebar — server selector, tab navigation, theme toggle, logout.
 * Collapses to a slide-in panel on mobile.
 */
import React from 'react';
import {
  HomeIcon, FolderIcon, PuzzleIcon, GlobeIcon, UsersIcon, TerminalIcon, ArchiveIcon, SlidersIcon,
  SunIcon, MoonIcon, LogOutIcon, ServerIcon,
} from './icons/index.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useServers } from '../hooks/useServers.js';
import { Select } from './ui/Select.jsx';
import { cx } from './ui/cx.js';

const NAV = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'files', label: 'Files', icon: FolderIcon },
  { id: 'mods', label: 'Mods', icon: PuzzleIcon },
  { id: 'worlds', label: 'Worlds', icon: GlobeIcon },
  { id: 'players', label: 'Players', icon: UsersIcon },
  { id: 'console', label: 'Console', icon: TerminalIcon },
  { id: 'backups', label: 'Backups', icon: ArchiveIcon },
  { id: 'config', label: 'Config', icon: SlidersIcon },
];

export function Sidebar({ active, onChange, username, onLogout, mobileOpen, onCloseMobile }) {
  const { theme, toggle } = useTheme();
  const { servers, selectedId, setSelectedId } = useServers();
  const Icon = theme === 'dark' ? SunIcon : MoonIcon;

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={cx(
          'fixed md:sticky top-0 left-0 z-40 h-screen w-64 shrink-0',
          'bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800',
          'flex flex-col transition-transform md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-600 text-white flex items-center justify-center shadow-sm">
              <ServerIcon width="16" height="16" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">mc-panel</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{username || 'user'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <Icon width="18" height="18" />
          </button>
        </div>

        <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800">
          <Select
            label="Server"
            value={selectedId || ''}
            onChange={(e) => setSelectedId(e.target.value || null)}
            options={
              servers.length
                ? servers.map((s) => ({ value: s.id, label: s.name }))
                : [{ value: '', label: 'No servers yet' }]
            }
          />
        </div>

        <nav className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          <ul className="space-y-0.5">
            {NAV.map((n) => {
              const Icon = n.icon;
              const isActive = active === n.id;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onChange(n.id)}
                    className={cx(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                      isActive
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200 font-medium'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                  >
                    <Icon width="18" height="18" />
                    <span>{n.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <LogOutIcon width="18" height="18" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
