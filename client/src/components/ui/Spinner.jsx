import React from 'react';
import { cx } from './cx.js';

/**
 * Spinner — small CSS-only spinner.
 */
export function Spinner({ size = 'md', className }) {
  const sizes = { xs: 'h-3 w-3 border', sm: 'h-4 w-4 border-2', md: 'h-6 w-6 border-2', lg: 'h-10 w-10 border-[3px]' };
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block rounded-full border-current border-r-transparent animate-spin',
        sizes[size] || sizes.md,
        className
      )}
    />
  );
}
