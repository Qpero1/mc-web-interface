/**
 * Shows a sticky banner whenever the shared Socket.io connection is
 * disconnected or attempting to reconnect.
 */
import React from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { Spinner } from './ui/Spinner.jsx';

export function ReconnectBanner() {
  const { status } = useSocket();
  if (status === 'connected' || status === 'connecting') return null;
  return (
    <div className="bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-100 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm flex items-center gap-2">
      <Spinner size="xs" />
      {status === 'reconnecting' ? 'Reconnecting to live updates…' : 'Disconnected from live updates — retrying…'}
    </div>
  );
}
