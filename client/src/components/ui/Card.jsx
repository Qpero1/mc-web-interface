import React from 'react';
import { cx } from './cx.js';

/**
 * Card — container with optional header and footer slots.
 */
export function Card({ children, header, footer, className, padded = true }) {
  return (
    <div
      className={cx(
        'rounded-xl border bg-white text-slate-900 shadow-sm',
        'border-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100',
        className
      )}
    >
      {header ? (
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          {header}
        </div>
      ) : null}
      <div className={cx(padded && 'p-4')}>{children}</div>
      {footer ? (
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800">{footer}</div>
      ) : null}
    </div>
  );
}
