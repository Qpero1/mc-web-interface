/**
 * SparkChart — tiny inline SVG line chart used for real-time stats.
 * No external chart deps. Props: data = array of numbers, color, height.
 */
import React, { useMemo } from 'react';
import { cx } from './ui/cx.js';

export function SparkChart({ data, color = '#1f8949', height = 64, max, min, suffix = '', className, label }) {
  const padding = 4;
  const points = data || [];
  const { d, fillD } = useMemo(() => {
    if (!points.length) return { d: '', fillD: '' };
    const lo = (min !== undefined ? min : Math.min(...points));
    const hi = (max !== undefined ? max : Math.max(...points, lo + 1));
    const range = Math.max(1e-6, hi - lo);
    const W = 200;
    const H = height;
    const yFor = (v) => H - padding - ((v - lo) / range) * (H - padding * 2);
    const xFor = (i) => padding + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - padding * 2));
    const segs = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(v).toFixed(2)}`);
    const baselineY = H - padding;
    const fill = [
      `M ${padding} ${baselineY}`,
      ...points.map((v, i) => `L ${xFor(i).toFixed(2)} ${yFor(v).toFixed(2)}`),
      `L ${(W - padding).toFixed(2)} ${baselineY}`,
      'Z',
    ].join(' ');
    return { d: segs.join(' '), fillD: fill };
  }, [points, height, max, min]);

  const last = points.length ? points[points.length - 1] : null;
  const lastDisplay = last !== null ? (Number.isInteger(last) ? last : last.toFixed(1)) + suffix : '–';

  return (
    <div className={cx('relative', className)}>
      <div className="flex justify-between items-baseline mb-1">
        {label ? <div className="text-xs text-slate-500">{label}</div> : null}
        <div className="text-sm font-semibold">{lastDisplay}</div>
      </div>
      <svg viewBox={`0 0 200 ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }}>
        {points.length === 0 ? (
          <text x="100" y={height / 2} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.4">no data yet</text>
        ) : (
          <>
            <path d={fillD} fill={color} opacity="0.12" />
            <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </div>
  );
}
