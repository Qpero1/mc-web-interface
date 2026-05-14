import React from 'react';
import { cx } from './cx.js';

/**
 * Breadcrumb — clickable path crumbs.
 * Props: items = [{ label, onClick? }]
 */
export function Breadcrumb({ items, className }) {
  return (
    <nav aria-label="Breadcrumb" className={cx('flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300 flex-wrap', className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {item.onClick && !last ? (
              <button
                type="button"
                onClick={item.onClick}
                className="hover:underline hover:text-slate-900 dark:hover:text-white"
              >
                {item.label}
              </button>
            ) : (
              <span className={last ? 'font-medium text-slate-900 dark:text-white' : ''}>{item.label}</span>
            )}
            {!last && <span className="opacity-40">/</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
