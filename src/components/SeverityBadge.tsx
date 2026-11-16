import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import type { SeverityLevel, WorkflowStatus } from '../types/pothsheba.ts';

export function SeverityIndicator({
  severity,
  compact = false,
}: {
  severity: SeverityLevel;
  compact?: boolean;
}) {
  const styles: Record<SeverityLevel, { text: string; bg: string; border: string; icon: React.ReactNode }> = {
    Critical: {
      text: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: <AlertOctagon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    High: {
      text: 'text-orange-700',
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    Medium: {
      text: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      icon: <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    Low: {
      text: 'text-teal-700',
      bg: 'bg-teal-50',
      border: 'border-teal-200',
      icon: <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const s = styles[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.bg} ${s.text} ${s.border}`}
    >
      {s.icon}
      <span>{compact ? severity : `${severity} severity`}</span>
    </span>
  );
}

export function StatusIndicator({ status }: { status: WorkflowStatus }) {
  const styles: Record<WorkflowStatus, { text: string; bg: string; border: string; icon: React.ReactNode }> = {
    Unconfirmed: {
      text: 'text-slate-600',
      bg: 'bg-slate-100',
      border: 'border-slate-300 border-dashed',
      icon: <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    Confirmed: {
      text: 'text-sky-800',
      bg: 'bg-sky-50',
      border: 'border-sky-200',
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    Assigned: {
      text: 'text-indigo-800',
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
      icon: <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    'In Progress': {
      text: 'text-amber-800',
      bg: 'bg-amber-50',
      border: 'border-amber-300',
      icon: <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
    Resolved: {
      text: 'text-emerald-800',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />,
    },
  };

  const s = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${s.bg} ${s.text} ${s.border}`}
    >
      {s.icon}
      <span>{status}</span>
    </span>
  );
}
