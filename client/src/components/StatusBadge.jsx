import React from 'react';

export const STATUSES = ['Kutilayotgan', 'Jarayonda', 'Tugallangan', 'Bekor qilingan'];

export const STATUS_META = {
  Kutilayotgan: {
    label: 'Kutilayotgan',
    dot: 'bg-sky-400',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  Jarayonda: {
    label: 'Jarayonda',
    dot: 'bg-amber-400',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  Tugallangan: {
    label: 'Tugallangan',
    dot: 'bg-emerald-400',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  'Bekor qilingan': {
    label: 'Bekor qilingan',
    dot: 'bg-zinc-400',
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
  },
};

export default function StatusBadge({ status, withDot = true, className = '' }) {
  const meta = STATUS_META[status] || {
    label: status || '—',
    dot: 'bg-zinc-400',
    className: 'border-white/10 bg-white/5 text-white/60',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className} ${className}`}
    >
      {withDot && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta.label}
    </span>
  );
}
