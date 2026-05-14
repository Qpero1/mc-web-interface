import React from 'react';
import { cx } from './cx.js';

/**
 * Badge — small status indicator. Variants map to neutral/online/offline/
 * disabled/warning/info. `dot` adds a leading colored dot.
 */
export function Badge({ children, variant = 'neutral', dot = false, className }) {
  const variants = {
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
    online: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    offline: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
    disabled: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    enabled: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  };
  const dotColors = {
    online: 'bg-emerald-500',
    offline: 'bg-slate-400',
    disabled: 'bg-amber-500',
    warning: 'bg-amber-500',
    error: 'bg-rose-500',
    info: 'bg-sky-500',
    enabled: 'bg-emerald-500',
    neutral: 'bg-slate-400',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        variants[variant] || variants.neutral,
        className
      )}
    >
      {dot ? <span className={cx('w-1.5 h-1.5 rounded-full', dotColors[variant] || dotColors.neutral)} /> : null}
      {children}
    </span>
  );
}
