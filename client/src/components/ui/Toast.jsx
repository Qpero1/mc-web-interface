import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx.js';

/**
 * ToastProvider + useToast — global toast system.
 * Variants: success, error, warning, info. Auto-dismiss with progress bar.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved');
 *   toast.error('Boom', { title: 'Failed', ttl: 8000 });
 */
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((variant, message, opts = {}) => {
    const id = ++idRef.current;
    const ttl = opts.ttl ?? 4500;
    const item = { id, variant, message, title: opts.title, ttl };
    setItems((cur) => [...cur, item]);
    if (ttl > 0) setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    show: (m, o) => push('info', m, o),
    info: (m, o) => push('info', m, o),
    success: (m, o) => push('success', m, o),
    warning: (m, o) => push('warning', m, o),
    error: (m, o) => push('error', m, o),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="fixed z-[60] top-4 right-4 flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]" aria-live="polite">
          {items.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

function ToastItem({ toast, onDismiss }) {
  const variants = {
    info: 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950 text-sky-900 dark:text-sky-100',
    success: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-100',
    warning: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100',
    error: 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950 text-rose-900 dark:text-rose-100',
  };
  const bars = {
    info: 'bg-sky-500', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-rose-500',
  };
  return (
    <div
      className={cx(
        'relative overflow-hidden border rounded-lg shadow-md animate-slide-up pointer-events-auto',
        variants[toast.variant] || variants.info
      )}
      role="status"
    >
      <div className="flex items-start gap-3 p-3 pr-9">
        <div className="mt-0.5">
          <Icon variant={toast.variant} />
        </div>
        <div className="flex-1">
          {toast.title ? <div className="text-sm font-semibold">{toast.title}</div> : null}
          <div className="text-sm">{toast.message}</div>
        </div>
        <button type="button" className="absolute top-2 right-2 text-current opacity-70 hover:opacity-100" onClick={onDismiss} aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {toast.ttl > 0 ? (
        <div
          className={cx('h-1 animate-progress', bars[toast.variant] || bars.info)}
          style={{ animationDuration: `${toast.ttl}ms` }}
        />
      ) : null}
    </div>
  );
}

function Icon({ variant }) {
  const common = 'w-4 h-4';
  if (variant === 'success') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
  );
  if (variant === 'warning') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  );
  if (variant === 'error') return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
  );
  return (
    <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  );
}
