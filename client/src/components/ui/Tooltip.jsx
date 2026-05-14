import React, { useState } from 'react';
import { cx } from './cx.js';

/**
 * Tooltip — small CSS-only hover/focus tooltip. Wrap any element.
 * Best for short labels; not a full popover.
 */
export function Tooltip({ children, label, side = 'top', className }) {
  const [open, setOpen] = useState(false);
  if (!label) return children;
  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };
  return (
    <span
      className={cx('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={cx(
            'absolute z-30 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow dark:bg-slate-700 pointer-events-none',
            positions[side]
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
