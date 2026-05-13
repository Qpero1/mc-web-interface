import React, { forwardRef, useId } from 'react';
import { cx } from './cx.js';

/**
 * Select — labeled native select with consistent styling.
 *
 * Pass `options` as an array of `{ value, label }` or pass children.
 */
export const Select = forwardRef(function Select(
  { label, options, error, hint, className, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const selId = id || auto;
  return (
    <div className={cx('w-full', className)}>
      {label ? (
        <label htmlFor={selId} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
          {label}
        </label>
      ) : null}
      <div className={cx(
        'flex items-center rounded-lg border bg-white dark:bg-slate-900',
        'border-slate-300 dark:border-slate-700 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-300/40',
        error ? 'border-rose-400' : ''
      )}>
        <select
          ref={ref}
          id={selId}
          className="block w-full appearance-none bg-transparent outline-none px-3 py-2 text-sm pr-8"
          {...rest}
        >
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
              ))
            : children}
        </select>
        <svg className="pointer-events-none -ml-7 text-slate-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
});
