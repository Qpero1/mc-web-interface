import React from 'react';
import { cx } from './cx.js';

/**
 * Button — variants: primary, secondary, danger, ghost; sizes: sm/md/lg.
 * Supports `as` for rendering as a different element (e.g. anchor or label).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className,
  children,
  as: As = 'button',
  type = 'button',
  ...rest
}) {
  const variants = {
    primary:
      'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-300 dark:bg-brand-500 dark:hover:bg-brand-400',
    secondary:
      'bg-slate-100 text-slate-900 hover:bg-slate-200 active:bg-slate-300 focus-visible:ring-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
    danger:
      'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-300 dark:bg-rose-600 dark:hover:bg-rose-500',
    ghost:
      'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 focus-visible:ring-slate-300 dark:text-slate-200 dark:hover:bg-slate-800',
  };
  const sizes = {
    sm: 'h-8 px-2.5 text-xs gap-1.5 rounded-md',
    md: 'h-10 px-3.5 text-sm gap-2 rounded-lg',
    lg: 'h-12 px-4 text-base gap-2 rounded-lg',
  };

  return (
    <As
      type={As === 'button' ? type : undefined}
      disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center font-medium select-none transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true" />
      ) : null}
      {children}
    </As>
  );
}
