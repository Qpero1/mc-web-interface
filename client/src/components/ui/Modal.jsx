import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.jsx';
import { cx } from './cx.js';

/**
 * Modal — backdrop + close button + optional footer with confirm/cancel.
 * Renders into document.body via a portal. Closes on Esc and backdrop click.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  onConfirm,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  loading = false,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        className={cx(
          'relative w-full rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 animate-slide-up',
          sizes[size] || sizes.md
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto scrollbar-thin">
          {children}
        </div>
        {(footer || onConfirm) && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            {footer || (
              <>
                <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelText}</Button>
                {onConfirm && (
                  <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>{confirmText}</Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
