import React from 'react';
import {
  ISSUE_SOURCES,
  ISSUE_TYPES,
  WORKFLOW_STATUSES,
  type RoadIssue,
} from '../types/pothsheba.ts';

interface IssueChartsProps {
  issues: RoadIssue[];
  dataTimeRange: { start: string; end: string };
}

export function IssueCharts({ issues, dataTimeRange }: IssueChartsProps) {
  const startStr = new Date(dataTimeRange.start).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const endStr = new Date(dataTimeRange.end).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const typeCounts = ISSUE_TYPES.map((type) => ({
    label: type,
    count: issues.filter((i) => i.type === type).length,
  }));
  const maxType = Math.max(1, ...typeCounts.map((c) => c.count));

  const statusCounts = WORKFLOW_STATUSES.map((status) => ({
    label: status,
    count: issues.filter((i) => i.status === status).length,
    barColor:
      status === 'Resolved'
        ? 'bg-emerald-600'
        : status === 'In Progress'
        ? 'bg-amber-600'
        : status === 'Assigned'
        ? 'bg-indigo-600'
        : status === 'Confirmed'
        ? 'bg-sky-600'
        : 'bg-slate-400',
  }));
  const maxStatus = Math.max(1, ...statusCounts.map((c) => c.count));

  const sourceCounts = ISSUE_SOURCES.map((source) => ({
    label: source,
    count: issues.filter((i) => i.sources.includes(source)).length,
  }));
  const maxSource = Math.max(1, ...sourceCounts.map((c) => c.count));

  return (
    <section
      aria-label="Issue summary charts"
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Pilot Summary Analytics
          </h3>
          <p className="text-xs text-slate-500">
            Aggregated across filtered records ({issues.length} issue{issues.length === 1 ? '' : 's'})
          </p>
        </div>
        <div className="font-mono-tabular text-xs text-slate-500">
          Data range: {startStr} – {endStr}
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-500">
          No issues match the current filter selection. Clear filters to view distribution charts.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* By Type */}
          <div>
            <h4 className="mb-3 text-xs font-semibold text-slate-700">
              Issue Counts by Type
            </h4>
            <div className="space-y-2.5">
              {typeCounts.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-700">{item.label}</span>
                    <span className="font-mono-tabular font-semibold text-slate-900">
                      {item.count}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-700 transition-all"
                      style={{ width: `${(item.count / maxType) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Workflow Status */}
          <div>
            <h4 className="mb-3 text-xs font-semibold text-slate-700">
              Workflow Status Breakdown
            </h4>
            <div className="space-y-2.5">
              {statusCounts.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-700">{item.label}</span>
                    <span className="font-mono-tabular font-semibold text-slate-900">
                      {item.count}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${item.barColor}`}
                      style={{ width: `${(item.count / maxStatus) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* By Detection / Report Source */}
          <div>
            <h4 className="mb-3 text-xs font-semibold text-slate-700">
              Contributing Sources
            </h4>
            <div className="space-y-2.5">
              {sourceCounts.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-700">{item.label}</span>
                    <span className="font-mono-tabular font-semibold text-slate-900">
                      {item.count}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-700 transition-all"
                      style={{ width: `${(item.count / maxSource) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
