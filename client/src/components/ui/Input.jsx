import React, { forwardRef, useId } from 'react';
import { cx } from './cx.js';

/**
 * Input — labelled text/password input with error state. Forwards refs.
 */
export const Input = forwardRef(function Input(
  { label, error, hint, leftSlot, rightSlot, className, id, type = 'text', ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id || auto;
  return (
    <div className={cx('w-full', className)}>
      {label ? (
        <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
          {label}
        </label>
      ) : null}
      <div className={cx(
        'flex items-center rounded-lg border bg-white dark:bg-slate-900 transition-colors',
        'border-slate-300 dark:border-slate-700 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-300/40',
        error ? 'border-rose-400 focus-within:border-rose-500 focus-within:ring-rose-300/40' : ''
      )}>
        {leftSlot ? <span className="pl-2 text-slate-500">{leftSlot}</span> : null}
        <input
          ref={ref}
          id={inputId}
          type={type}
          className="block w-full bg-transparent outline-none px-3 py-2 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
          {...rest}
        />
        {rightSlot ? <span className="pr-2 text-slate-500">{rightSlot}</span> : null}
      </div>
      {error ? <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
});
