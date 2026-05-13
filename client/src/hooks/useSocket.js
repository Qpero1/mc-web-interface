import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getToken } from '../lib/api.js';

let sharedSocket = null;
let sharedSocketHolders = 0;

/**
 * Get (or lazily create) a shared Socket.io connection authenticated with
 * the stored JWT. Holders reference-count it so we tear down cleanly when
 * the last consumer unmounts.
 */
function getSharedSocket() {
  if (!sharedSocket) {
    sharedSocket = io({
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });
  }
  sharedSocketHolders += 1;
  return sharedSocket;
}

function releaseSharedSocket() {
  sharedSocketHolders = Math.max(0, sharedSocketHolders - 1);
  if (sharedSocketHolders === 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}

/**
 * useSocket — returns { socket, status }. status is one of:
 *   'connecting' | 'connected' | 'reconnecting' | 'disconnected'
 */
export function useSocket() {
  const socketRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const socket = getSharedSocket();
    socketRef.current = socket;
    setStatus(socket.connected ? 'connected' : 'connecting');

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onReconnectAttempt = () => setStatus('reconnecting');
    const onConnectError = () => setStatus('reconnecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('error', onConnectError);
    socket.io.on('reconnect_failed', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('error', onConnectError);
      socket.io.off('reconnect_failed', onDisconnect);
      releaseSharedSocket();
    };
  }, []);

  return { socket: socketRef.current, status };
}

/**
 * Force-rebuild the shared socket (used after login when the token changes).
 */
export function resetSocket() {
  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    sharedSocketHolders = 0;
  }
}
