import React, { useMemo, useState } from 'react';
import {
  Download,
  Filter,
  RotateCcw,
  SlidersHorizontal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  FIELD_WORKERS,
  ISSUE_SOURCES,
  ISSUE_TYPES,
  SEVERITY_LEVELS,
  WORKFLOW_STATUSES,
  type AppStateResponse,
  type PriorityWeights,
  type RoadIssue,
  type WorkflowStatus,
} from '../types/pothsheba.ts';
import { PilotMap } from './PilotMap.tsx';
import { IssueCharts } from './IssueCharts.tsx';
import { SeverityIndicator, StatusIndicator } from './SeverityBadge.tsx';

interface AuthorityDashboardProps {
  data: AppStateResponse;
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
  onUpdateIssue: (
    issueId: string,
    patch: {
      status?: WorkflowStatus;
      assignedWorker?: string | null;
      officerNotes?: string;
      resolutionNotes?: string;
    }
  ) => Promise<void>;
  onUpdateWeights: (weights: PriorityWeights) => Promise<void>;
  onResetDemo: () => Promise<void>;
  onNavigateDevices: () => void;
}

export function AuthorityDashboard({
  data,
  selectedIssueId,
  onSelectIssue,
  onUpdateIssue,
  onUpdateWeights,
  onResetDemo,
  onNavigateDevices,
}: AuthorityDashboardProps) {
  const [filterType, setFilterType] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterRoad, setFilterRoad] = useState<string>('');
  const [filterDate, setFilterDate] = useState<'all' | '24h' | '7d'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [showWeights, setShowWeights] = useState(false);
  const [draftWeights, setDraftWeights] = useState<PriorityWeights>(data.weights);
  const [savingWeights, setSavingWeights] = useState(false);

  // Local edit states for selected issue
  const selectedIssue = useMemo(
    () => data.issues.find((i) => i.id === selectedIssueId) ?? null,
    [data.issues, selectedIssueId]
  );

  const [editStatus, setEditStatus] = useState<WorkflowStatus>('Confirmed');
  const [editWorker, setEditWorker] = useState<string>('');
  const [editOfficerNotes, setEditOfficerNotes] = useState<string>('');
  const [editResolutionNotes, setEditResolutionNotes] = useState<string>('');
  const [savingIssue, setSavingIssue] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Sync draft form when selected issue changes
  React.useEffect(() => {
    if (selectedIssue) {
      setEditStatus(selectedIssue.status);
      setEditWorker(selectedIssue.assignedWorker ?? '');
      setEditOfficerNotes(selectedIssue.officerNotes);
      setEditResolutionNotes(selectedIssue.resolutionNotes);
      setSaveMessage(null);
    }
  }, [selectedIssue]);

  React.useEffect(() => {
    setDraftWeights(data.weights);
  }, [data.weights]);

  const filteredIssues = useMemo(() => {
    const now = Date.now();
    const q = searchQuery.trim().toLowerCase();

    return data.issues
      .filter((issue) => {
        if (filterType && issue.type !== filterType) return false;
        if (filterSeverity && issue.severity !== filterSeverity) return false;
        if (filterStatus && issue.status !== filterStatus) return false;
        if (filterSource && !issue.sources.includes(filterSource as RoadIssue['sources'][number])) {
          return false;
        }
        if (filterRoad && issue.roadName !== filterRoad) return false;
        if (filterDate !== 'all') {
          const ageMs = now - new Date(issue.createdAt).getTime();
          const limit = filterDate === '24h' ? 86_400_000 : 7 * 86_400_000;
          if (ageMs > limit) return false;
        }
        if (q) {
          const hay = `${issue.id} ${issue.type} ${issue.roadName} ${issue.nearestLandmark} ${issue.aiSummary} ${issue.officerNotes}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Resolved items sit below active items unless explicitly filtered
        if (a.status === 'Resolved' && b.status !== 'Resolved') return 1;
        if (b.status === 'Resolved' && a.status !== 'Resolved') return -1;
        return b.priorityScore - a.priorityScore;
      });
  }, [
    data.issues,
    filterType,
    filterSeverity,
    filterStatus,
    filterSource,
    filterRoad,
    filterDate,
    searchQuery,
  ]);

  const kpis = useMemo(() => {
    const active = data.issues.filter((i) => i.status !== 'Resolved');
    const unconfirmed = active.filter((i) => i.status === 'Unconfirmed').length;
    const critical = active.filter((i) => i.severity === 'Critical').length;
    const inRepair = active.filter(
      (i) => i.status === 'Assigned' || i.status === 'In Progress'
    ).length;
    const resolved = data.issues.filter((i) => i.status === 'Resolved').length;
    return {
      activeCount: active.length,
      unconfirmed,
      critical,
      inRepair,
      resolved,
    };
  }, [data.issues]);

  const handleSaveIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIssue) return;
    setSavingIssue(true);
    setSaveMessage(null);
    try {
      await onUpdateIssue(selectedIssue.id, {
        status: editStatus,
        assignedWorker: editWorker || null,
        officerNotes: editOfficerNotes,
        resolutionNotes: editResolutionNotes,
      });
      setSaveMessage('Issue record updated.');
    } catch {
      setSaveMessage('Could not update issue. Please retry.');
    } finally {
      setSavingIssue(false);
    }
  };

  const handleApplyWeights = async () => {
    setSavingWeights(true);
    try {
      await onUpdateWeights(draftWeights);
    } finally {
      setSavingWeights(false);
    }
  };

  const handleExportCsv = () => {
    const escapeCell = (val: string | number) =>
      `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      'ID',
      'Type',
      'Status',
      'Severity',
      'PriorityScore',
      'Road',
      'NearestLandmark',
      'Confirmations',
      'Sources',
      'Lat',
      'Lng',
      'AssignedWorker',
      'SimulatedSample',
      'CreatedAt',
    ];
    const rows = filteredIssues.map((i) => [
      i.id,
      i.type,
      i.status,
      i.severity,
      i.priorityScore,
      i.roadName,
      i.nearestLandmark,
      i.confirmationCount,
      i.sources.join('; '),
      i.lat.toFixed(6),
      i.lng.toFixed(6),
      i.assignedWorker ?? '',
      i.isSimulated ? 'Yes' : 'No',
      i.createdAt,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCell).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pothsheba-pilot-issues.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setFilterType('');
    setFilterSeverity('');
    setFilterStatus('');
    setFilterSource('');
    setFilterRoad('');
    setFilterDate('all');
    setSearchQuery('');
  };

  const weightSum = draftWeights.size + draftWeights.traffic + draftWeights.risk || 1;

  return (
    <div className="space-y-6">
      {/* Pilot Context & Actions Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Authority Operations Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Pilot scope: {data.pilotMeta.areaName} · Sample &amp; simulated sensor records are explicitly labeled.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowWeights((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Priority Formula Weights</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={onResetDemo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Pilot Sample</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Active Issues</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">
            {kpis.activeCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Excluding resolved</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Critical Priority</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-red-700">
            {kpis.critical}
          </div>
          <div className="mt-1 text-xs text-slate-500">Score 75+ (immediate)</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Unconfirmed</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-700">
            {kpis.unconfirmed}
          </div>
          <div className="mt-1 text-xs text-slate-500">Needs 2+ reports</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Assigned / In Progress</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-indigo-700">
            {kpis.inRepair}
          </div>
          <div className="mt-1 text-xs text-slate-500">Field crew active</div>
        </div>
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 sm:col-span-1">
          <div className="text-xs font-medium text-slate-500">Resolved</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700">
            {kpis.resolved}
          </div>
          <div className="mt-1 text-xs text-slate-500">Completed repairs</div>
        </div>
      </div>

      {/* Configurable Priority Weights Panel */}
      {showWeights && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Configurable Priority Formula Weights
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Proposal baseline: <code className="font-mono-tabular font-semibold">0.4 × Size + 0.3 × Traffic + 0.3 × Risk</code>. These weights are starting heuristic values that can be tuned through pilot testing — not scientifically validated thresholds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const defaults = { size: 0.4, traffic: 0.3, risk: 0.3 };
                setDraftWeights(defaults);
                onUpdateWeights(defaults);
              }}
              className="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap"
            >
              Restore 0.4 / 0.3 / 0.3 defaults
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700">
              <div className="mb-1 flex justify-between">
                <span>Size Weight</span>
                <span className="font-mono-tabular font-semibold">
                  {(draftWeights.size / weightSum).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={draftWeights.size}
                onChange={(e) =>
                  setDraftWeights({ ...draftWeights, size: Number(e.target.value) })
                }
                className="w-full accent-teal-700"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              <div className="mb-1 flex justify-between">
                <span>Traffic Corridor Weight</span>
                <span className="font-mono-tabular font-semibold">
                  {(draftWeights.traffic / weightSum).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={draftWeights.traffic}
                onChange={(e) =>
                  setDraftWeights({ ...draftWeights, traffic: Number(e.target.value) })
                }
                className="w-full accent-teal-700"
              />
            </label>
            <label className="block text-xs font-medium text-slate-700">
              <div className="mb-1 flex justify-between">
                <span>Risk Context Weight (School/Hospital/Bus)</span>
                <span className="font-mono-tabular font-semibold">
                  {(draftWeights.risk / weightSum).toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={draftWeights.risk}
                onChange={(e) =>
                  setDraftWeights({ ...draftWeights, risk: Number(e.target.value) })
                }
                className="w-full accent-teal-700"
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              disabled={savingWeights}
              onClick={handleApplyWeights}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {savingWeights ? 'Recalculating...' : 'Apply & Re-Rank Issues'}
            </button>
          </div>
        </section>
      )}

      {/* Filter Toolbar */}
      <section
        aria-label="Issue filters"
        className="rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mr-1">
            <Filter className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>Filters</span>
          </div>

          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ID, road, landmark..."
            aria-label="Search issues"
            className="w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none"
          />

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter by issue type"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="">All types</option>
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            aria-label="Filter by severity"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="">All severity</option>
            {SEVERITY_LEVELS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filter by workflow status"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="">All statuses</option>
            {WORKFLOW_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            aria-label="Filter by source"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="">All sources</option>
            {ISSUE_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>

          <select
            value={filterRoad}
            onChange={(e) => setFilterRoad(e.target.value)}
            aria-label="Filter by road location"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="">All pilot roads</option>
            {data.pilotMeta.roads.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>

          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value as 'all' | '24h' | '7d')}
            aria-label="Filter by date range"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
          >
            <option value="all">All dates</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>

          {(filterType ||
            filterSeverity ||
            filterStatus ||
            filterSource ||
            filterRoad ||
            filterDate !== 'all' ||
            searchQuery) && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-semibold text-teal-700 hover:underline px-2"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Main Split: Map + Sensor Strip on Left, Ranked List + Inspector on Right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <PilotMap
            center={data.pilotMeta.center}
            roads={data.pilotMeta.roads}
            landmarks={data.pilotMeta.landmarks}
            issues={filteredIssues}
            devices={data.devices}
            selectedIssueId={selectedIssueId}
            onSelectIssue={onSelectIssue}
            heightClass="h-[500px]"
          />

          {/* Compact Pilot Sensor Status Strip */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Pilot Sensor Nodes (3 Simulated Hardware Units)
                </h2>
                <p className="text-xs text-slate-500">
                  ESP32 / ESP32-CAM / MPU6050 / NEO-6M / HC-SR04 demo telemetry
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateDevices}
                className="text-xs font-semibold text-teal-700 hover:underline whitespace-nowrap"
              >
                Open IoT &amp; Queue Controls
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.devices.map((dev) => (
                <div
                  key={dev.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {dev.name}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        dev.status === 'Offline'
                          ? 'text-slate-600'
                          : 'text-emerald-700'
                      }`}
                    >
                      {dev.status === 'Offline' ? (
                        <WifiOff className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Wifi className="h-3 w-3" aria-hidden="true" />
                      )}
                      {dev.status}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-600">{dev.roadName}</div>
                  <div className="mt-2 font-mono-tabular text-[11px] text-slate-500">
                    {dev.category === 'vehicle'
                      ? `Peak: ${dev.latestReadings.vibrationPeakG?.toFixed(2) ?? '—'}g · Queue: ${dev.offlineQueue.length}`
                      : `Water: ${dev.latestReadings.waterLevelCm ?? 0} cm · Bin: ${dev.latestReadings.binFillPct ?? 0}% · Light: ${dev.latestReadings.streetLightState ?? 'On'}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Ranked List & Issue Inspector */}
        <div className="space-y-4 lg:col-span-5">
          {/* Ranked Repair List */}
          <section
            aria-label="Ranked repair list"
            className="rounded-xl border border-slate-200 bg-white"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Ranked Repair Priority List
                </h2>
                <p className="text-xs text-slate-500">
                  Sorted by {data.weights.size.toFixed(1)}×Size +{' '}
                  {data.weights.traffic.toFixed(1)}×Traffic +{' '}
                  {data.weights.risk.toFixed(1)}×Risk
                </p>
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-slate-600">
                {filteredIssues.length} shown
              </span>
            </div>

            <div className="max-h-[280px] divide-y divide-slate-100 overflow-y-auto">
              {filteredIssues.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  No matching issues found. Adjust filters or submit a report.
                </div>
              ) : (
                filteredIssues.map((issue) => {
                  const isSelected = issue.id === selectedIssueId;
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => onSelectIssue(issue.id)}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                        isSelected ? 'bg-teal-50/70' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono-tabular text-xs font-bold text-slate-900">
                              {issue.id}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">
                              {issue.type}
                            </span>
                            {issue.isSimulated && (
                              <span className="text-[11px] font-medium text-slate-500">
                                · Sample Data
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {issue.roadName} · {issue.confirmationCount} report
                            {issue.confirmationCount === 1 ? '' : 's'} ·{' '}
                            {issue.sources.join(', ')}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="font-mono-tabular text-sm font-bold text-slate-900">
                            {issue.priorityScore}/100
                          </span>
                          <SeverityIndicator severity={issue.severity} compact />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <StatusIndicator status={issue.status} />
                        <span className="font-mono-tabular text-[11px] text-slate-500">
                          {new Date(issue.createdAt).toLocaleString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Selected Issue Inspector */}
          <section
            aria-label="Issue details and officer actions"
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            {!selectedIssue ? (
              <div className="py-10 text-center text-sm text-slate-500">
                Select an issue from the map or ranked list to inspect evidence, AI vs. officer notes, and workflow controls.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-tabular text-sm font-bold text-slate-900">
                        {selectedIssue.id}
                      </span>
                      <h3 className="text-base font-bold text-slate-900">
                        {selectedIssue.type}
                      </h3>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {selectedIssue.roadName} ·{' '}
                      <span className="font-mono-tabular">
                        {selectedIssue.lat.toFixed(5)}, {selectedIssue.lng.toFixed(5)}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SeverityIndicator severity={selectedIssue.severity} compact />
                    <StatusIndicator status={selectedIssue.status} />
                  </div>
                </div>

                {/* Explainable Priority Breakdown */}
                <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between font-semibold text-slate-800">
                    <span>Priority Score Breakdown</span>
                    <span className="font-mono-tabular text-sm text-slate-900">
                      {selectedIssue.priorityScore} / 100
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono-tabular text-[11px] text-slate-700">
                    <div>Size: {Math.round(selectedIssue.sizeScore)}</div>
                    <div>Traffic: {Math.round(selectedIssue.trafficScore)}</div>
                    <div>Risk: {Math.round(selectedIssue.riskScore)}</div>
                  </div>
                  <ul className="list-disc space-y-1 pl-4 text-slate-600">
                    {selectedIssue.scoreReasons.map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                </div>

                {/* Clear distinction: Simulated AI Summary vs Officer-Confirmed Record */}
                <div className="space-y-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="font-semibold text-slate-800">
                      Simulated AI &amp; Sensor Summary (Non-Authoritative)
                    </div>
                    <p className="mt-1 text-slate-600">{selectedIssue.aiSummary}</p>
                    <div className="mt-2 flex flex-wrap gap-3 font-mono-tabular text-[11px] text-slate-500">
                      <span>Methods: {selectedIssue.detectionMethods.join(', ')}</span>
                      {selectedIssue.aiConfidence != null && (
                        <span>
                          YOLO Conf (Sim): {(selectedIssue.aiConfidence * 100).toFixed(0)}%
                        </span>
                      )}
                      {selectedIssue.vibrationPeakG != null && (
                        <span>
                          MPU6050: {selectedIssue.vibrationPeakG.toFixed(2)}g /{' '}
                          {selectedIssue.vibrationDurationMs ?? 0} ms
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedIssue.officerNotes && (
                    <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                      <div className="font-semibold text-teal-900">
                        Officer-Confirmed Field Note
                      </div>
                      <p className="mt-1 text-teal-800">{selectedIssue.officerNotes}</p>
                    </div>
                  )}
                </div>

                {/* Officer Workflow Form */}
                <form onSubmit={handleSaveIssue} className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Workflow Status
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value as WorkflowStatus)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                      >
                        {WORKFLOW_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs font-medium text-slate-700">
                      Assign Field Worker
                      <select
                        value={editWorker}
                        onChange={(e) => setEditWorker(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                      >
                        <option value="">Unassigned</option>
                        {FIELD_WORKERS.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="block text-xs font-medium text-slate-700">
                    Officer Review Notes (Confirmed Facts)
                    <textarea
                      rows={2}
                      value={editOfficerNotes}
                      onChange={(e) => setEditOfficerNotes(e.target.value)}
                      placeholder="Record field verification details..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </label>

                  <label className="block text-xs font-medium text-slate-700">
                    Resolution Notes
                    <textarea
                      rows={2}
                      value={editResolutionNotes}
                      onChange={(e) => setEditResolutionNotes(e.target.value)}
                      placeholder="Document repair materials, clearance, or closure check..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </label>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-teal-700 font-medium">
                      {saveMessage ?? ''}
                    </span>
                    <button
                      type="submit"
                      disabled={savingIssue}
                      className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {savingIssue ? 'Saving...' : 'Save Officer Update'}
                    </button>
                  </div>
                </form>

                {/* Supporting Evidence & History */}
                <div className="space-y-3 border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <h4 className="font-semibold text-slate-800">
                      Supporting Reports ({selectedIssue.confirmationCount})
                    </h4>
                    <div className="mt-2 space-y-2">
                      {selectedIssue.evidenceReports.map((ev) => (
                        <div
                          key={ev.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">
                              {ev.source} · {ev.reporterLabel}
                            </span>
                            <span className="font-mono-tabular">
                              {new Date(ev.timestamp).toLocaleString('en-GB')}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-700">{ev.note}</p>
                          {ev.photoDataUrl && (
                            <div className="mt-2">
                              <img
                                src={ev.photoDataUrl}
                                alt={`Evidence for ${selectedIssue.id}`}
                                referrerPolicy="no-referrer"
                                className="max-h-36 rounded-md border border-slate-200 object-cover"
                              />
                              <p className="mt-1 text-[11px] text-slate-500">
                                Privacy check:{' '}
                                {ev.privacyBlurApplied
                                  ? `${ev.privacyBlurMethod} applied locally before upload.`
                                  : 'No automatic anonymization applied — do not assume faces/plates are blurred.'}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-800">Audit History</h4>
                    <ul className="mt-1.5 space-y-1.5 text-[11px] text-slate-600">
                      {selectedIssue.history.map((h, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span className="font-mono-tabular text-slate-400 shrink-0">
                            {new Date(h.timestamp).toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span>
                            <strong className="text-slate-800">{h.action}</strong> ({h.actor}):{' '}
                            {h.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Summary Charts with Explicit Time Range */}
      <IssueCharts issues={filteredIssues} dataTimeRange={data.dataTimeRange} />
    </div>
  );
}
