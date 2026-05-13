/**
 * Login screen. Submits credentials, stores the JWT, and calls onAuthed.
 */
import React, { useState } from 'react';
import { Button, Card, Input } from './ui';
import { LockIcon, ServerIcon } from './icons/index.jsx';
import { api, setToken } from '../lib/api.js';
import { useToast } from './ui/Toast.jsx';

export function Login({ onAuthed }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(token);
      toast.success('Logged in');
      onAuthed?.();
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="h-12 w-12 rounded-xl bg-brand-600 text-white flex items-center justify-center shadow">
            <ServerIcon />
          </div>
          <h1 className="mt-3 text-xl font-semibold">mc-panel</h1>
          <p className="text-sm text-slate-500">Sign in to manage your servers</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              leftSlot={<LockIcon width="14" height="14" />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
            <Button type="submit" loading={loading} className="w-full">Sign in</Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          Even on Tailscale, every device still needs to log in.
        </p>
      </div>
    </div>
  );
}
