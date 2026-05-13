import React, { useId } from 'react';
import { cx } from './cx.js';

/**
 * Toggle — accessible on/off switch. `checked` + `onChange(value:boolean)`.
 */
export function Toggle({ checked, onChange, label, disabled = false, className, size = 'md' }) {
  const id = useId();
  const sizes = {
    sm: { container: 'h-4 w-7', knob: 'h-3 w-3', off: 'translate-x-0.5', on: 'translate-x-3.5' },
    md: { container: 'h-5 w-9', knob: 'h-4 w-4', off: 'translate-x-0.5', on: 'translate-x-4' },
    lg: { container: 'h-6 w-11', knob: 'h-5 w-5', off: 'translate-x-0.5', on: 'translate-x-5' },
  };
  const s = sizes[size] || sizes.md;
  return (
    <label htmlFor={id} className={cx('inline-flex items-center gap-2 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)}>
      <span className="relative inline-block">
        <input
          id={id}
          type="checkbox"
          className="sr-only"
          checked={!!checked}
          onChange={(e) => onChange?.(e.target.checked)}
          disabled={disabled}
        />
        <span
          aria-hidden="true"
          className={cx(
            'inline-block rounded-full transition-colors',
            s.container,
            checked ? 'bg-brand-600 dark:bg-brand-500' : 'bg-slate-300 dark:bg-slate-700'
          )}
        />
        <span
          aria-hidden="true"
          className={cx(
            'absolute top-0.5 left-0 rounded-full bg-white shadow transition-transform',
            s.knob,
            checked ? s.on : s.off
          )}
        />
      </span>
      {label ? <span className="text-sm">{label}</span> : null}
    </label>
  );
}
