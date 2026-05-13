/**
 * client/src/App.jsx
 * Top-level shell. Decides whether to render the Login screen or the main
 * panel (with sidebar + active tab). Also wires up the reconnect banner.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ServerProvider } from './context/ServerContext.jsx';
import { Login } from './components/Login.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { ReconnectBanner } from './components/ReconnectBanner.jsx';
import { Home } from './components/tabs/Home.jsx';
import { Files } from './components/tabs/Files.jsx';
import { Mods } from './components/tabs/Mods.jsx';
import { Worlds } from './components/tabs/Worlds.jsx';
import { Players } from './components/tabs/Players.jsx';
import { Console } from './components/tabs/Console.jsx';
import { Backups } from './components/tabs/Backups.jsx';
import { ConfigEditor } from './components/tabs/ConfigEditor.jsx';
import { getToken, clearToken, api } from './lib/api.js';
import { resetSocket } from './hooks/useSocket.js';

const TABS = {
  home: Home,
  files: Files,
  mods: Mods,
  worlds: Worlds,
  players: Players,
  console: Console,
  backups: Backups,
  config: ConfigEditor,
};

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [username, setUsername] = useState('');

  useEffect(() => {
    const onUnauth = () => { clearToken(); resetSocket(); setAuthed(false); };
    window.addEventListener('mcpanel:unauthorized', onUnauth);
    return () => window.removeEventListener('mcpanel:unauthorized', onUnauth);
  }, []);

  useEffect(() => {
    if (!authed) return undefined;
    let mounted = true;
    api('/api/me').then((d) => { if (mounted) setUsername(d.username); }).catch(() => {});
    return () => { mounted = false; };
  }, [authed]);

  const onLogout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (_e) { /* ignore */ }
    clearToken();
    resetSocket();
    setAuthed(false);
  }, []);

  if (!authed) {
    return <Login onAuthed={() => { resetSocket(); setAuthed(true); }} />;
  }

  const TabComponent = TABS[tab] || Home;

  return (
    <ServerProvider>
      <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950">
        <Sidebar
          active={tab}
          onChange={(t) => { setTab(t); setSidebarOpen(false); }}
          username={username}
          onLogout={onLogout}
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
        />
        <main className="flex-1 flex flex-col min-w-0">
          <header className="md:hidden sticky top-0 z-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open menu"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <span className="font-semibold">mc-panel</span>
          </header>
          <ReconnectBanner />
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="max-w-7xl mx-auto p-4 md:p-6">
              <TabComponent />
            </div>
          </div>
        </main>
      </div>
    </ServerProvider>
  );
}
