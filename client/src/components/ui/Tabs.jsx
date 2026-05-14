import React from 'react';
import { cx } from './cx.js';

/**
 * Tabs — controlled horizontal tab list.
 * Props: tabs = [{ id, label, icon? }], value, onChange.
 */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={cx('flex gap-1 border-b border-slate-200 dark:border-slate-800', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange?.(t.id)}
            className={cx(
              'inline-flex items-center gap-2 px-3 h-9 text-sm border-b-2 -mb-px transition-colors',
              active
                ? 'border-brand-500 text-brand-700 dark:text-brand-300'
                : 'border-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            )}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
