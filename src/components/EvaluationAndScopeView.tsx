import React, { useMemo, useState } from 'react';
import { ClipboardCheck, Target } from 'lucide-react';
import type { AppStateResponse } from '../types/pothsheba.ts';

interface EvaluationAndScopeViewProps {
  data: AppStateResponse;
  onAddEvaluationRun: (payload: {
    runLabel: string;
    roadSegment: string;
    manualCount: number;
    truePositives: number;
    falsePositives: number;
    avgDetectionDelaySec: number;
    speedBreakersTested: number;
    speedBreakersCorrectlyFiltered: number;
    notes: string;
  }) => Promise<void>;
}

export function EvaluationAndScopeView({
  data,
  onAddEvaluationRun,
}: EvaluationAndScopeViewProps) {
  const [runLabel, setRunLabel] = useState('');
  const [roadSegment, setRoadSegment] = useState('Campus Main Rd (1.2 km)');
  const [manualCount, setManualCount] = useState(10);
  const [truePositives, setTruePositives] = useState(8);
  const [falsePositives, setFalsePositives] = useState(1);
  const [avgDelay, setAvgDelay] = useState(9.5);
  const [breakersTested, setBreakersTested] = useState(3);
  const [breakersFiltered, setBreakersFiltered] = useState(3);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const summaryMetrics = useMemo(() => {
    const runs = data.evaluationRuns;
    if (runs.length === 0) {
      return {
        precisionPct: null,
        recallPct: null,
        avgDelaySec: null,
        totalFalseAlarms: 0,
      };
    }
    const tp = runs.reduce((acc, r) => acc + r.truePositives, 0);
    const fp = runs.reduce((acc, r) => acc + r.falsePositives, 0);
    const manual = runs.reduce((acc, r) => acc + r.manualCount, 0);
    const avgD =
      runs.reduce((acc, r) => acc + r.avgDetectionDelaySec, 0) / runs.length;

    return {
      precisionPct: tp + fp > 0 ? Math.round((tp / (tp + fp)) * 100) : 0,
      recallPct: manual > 0 ? Math.round((tp / manual) * 100) : 0,
      avgDelaySec: Number(avgD.toFixed(1)),
      totalFalseAlarms: fp,
    };
  }, [data.evaluationRuns]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    try {
      await onAddEvaluationRun({
        runLabel: runLabel.trim() || `Pilot Field Run #${data.evaluationRuns.length + 1}`,
        roadSegment,
        manualCount,
        truePositives: Math.min(truePositives, manualCount),
        falsePositives,
        avgDetectionDelaySec: avgDelay,
        speedBreakersTested: breakersTested,
        speedBreakersCorrectlyFiltered: Math.min(breakersFiltered, breakersTested),
        notes,
      });
      setRunLabel('');
      setNotes('');
      setSavedMsg('Pilot evaluation run recorded.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Pilot Testing Evaluation &amp; Project Scope
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Record field-test metrics against manual road counts and review proposal targets vs. strict pilot boundaries.
        </p>
      </div>

      {/* Proposal Targets Banner (Explicitly Targets, Not Achieved Claims) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 text-teal-700 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <h2 className="text-base font-bold text-slate-900">
              Proposal Target Benchmarks (Goals to Validate, Not Achieved Results)
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-slate-500">Target Precision</div>
                <div className="mt-0.5 font-mono-tabular text-lg font-bold text-slate-900">
                  &gt; 80%
                </div>
                <div className="text-slate-600">On pilot test road set</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-slate-500">Target Recall</div>
                <div className="mt-0.5 font-mono-tabular text-lg font-bold text-slate-900">
                  &gt; 80%
                </div>
                <div className="text-slate-600">Against manual pothole count</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-slate-500">Target Map Latency</div>
                <div className="mt-0.5 font-mono-tabular text-lg font-bold text-slate-900">
                  ~10 sec
                </div>
                <div className="text-slate-600">Event to map with good internet</div>
              </div>
            </div>
            <p className="text-xs text-slate-600">
              Note: Sample runs below marked <strong>Sample Simulated</strong> are seeded demo records only. Log real Week-11 pilot field tests on the right to compute actual evaluation figures.
            </p>
          </div>
        </div>
      </section>

      {/* Recorded Runs + Log Form */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-4 lg:col-span-7">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-xs text-slate-500">Recorded Precision</div>
              <div className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
                {summaryMetrics.precisionPct == null ? '—' : `${summaryMetrics.precisionPct}%`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-xs text-slate-500">Recorded Recall</div>
              <div className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
                {summaryMetrics.recallPct == null ? '—' : `${summaryMetrics.recallPct}%`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-xs text-slate-500">Avg Delay</div>
              <div className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
                {summaryMetrics.avgDelaySec == null ? '—' : `${summaryMetrics.avgDelaySec} s`}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="text-xs text-slate-500">False Alarms</div>
              <div className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
                {summaryMetrics.totalFalseAlarms}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-bold text-slate-900">
                Pilot Evaluation Runs vs. Manual Count
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Run / Corridor</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Manual</th>
                    <th className="px-3 py-2.5 font-semibold text-right">TP</th>
                    <th className="px-3 py-2.5 font-semibold text-right">FP</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Precision</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Recall</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Delay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.evaluationRuns.map((run) => {
                    const prec =
                      run.truePositives + run.falsePositives > 0
                        ? Math.round(
                            (run.truePositives /
                              (run.truePositives + run.falsePositives)) *
                              100
                          )
                        : 0;
                    const rec =
                      run.manualCount > 0
                        ? Math.round((run.truePositives / run.manualCount) * 100)
                        : 0;
                    return (
                      <tr key={run.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {run.runLabel}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {run.roadSegment} · {run.date} ·{' '}
                            <span
                              className={
                                run.isSampleSimulated
                                  ? 'font-semibold text-amber-700'
                                  : 'font-semibold text-teal-700'
                              }
                            >
                              {run.isSampleSimulated ? 'Sample Simulated' : 'Recorded Field Test'}
                            </span>
                          </div>
                          {run.notes && (
                            <div className="mt-1 text-[11px] text-slate-600">
                              {run.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono-tabular">
                          {run.manualCount}
                        </td>
                        <td className="px-3 py-3 text-right font-mono-tabular">
                          {run.truePositives}
                        </td>
                        <td className="px-3 py-3 text-right font-mono-tabular">
                          {run.falsePositives}
                        </td>
                        <td className="px-3 py-3 text-right font-mono-tabular font-semibold">
                          {prec}%
                        </td>
                        <td className="px-3 py-3 text-right font-mono-tabular font-semibold">
                          {rec}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular">
                          {run.avgDetectionDelaySec.toFixed(1)}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Log New Field Test Run */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
            <ClipboardCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-900">
              Record Pilot Road Field Test
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            <label className="block font-medium text-slate-700">
              Test Run Label
              <input
                type="text"
                value={runLabel}
                onChange={(e) => setRunLabel(e.target.value)}
                placeholder="e.g., Week 11 Morning Campus Test"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
            </label>

            <label className="block font-medium text-slate-700">
              Pilot Road Segment
              <select
                value={roadSegment}
                onChange={(e) => setRoadSegment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option>Campus Main Rd (1.2 km)</option>
                <option>Ashulia Link Rd (0.8 km)</option>
                <option>Birulia Market Rd (0.7 km)</option>
                <option>Khagan Bazar Rd (0.6 km)</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block font-medium text-slate-700">
                Manual Ground-Truth Count
                <input
                  type="number"
                  min={1}
                  value={manualCount}
                  onChange={(e) => setManualCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
              <label className="block font-medium text-slate-700">
                True Positives Detected
                <input
                  type="number"
                  min={0}
                  max={manualCount}
                  value={truePositives}
                  onChange={(e) => setTruePositives(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
              <label className="block font-medium text-slate-700">
                False Alarms (FP)
                <input
                  type="number"
                  min={0}
                  value={falsePositives}
                  onChange={(e) => setFalsePositives(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
              <label className="block font-medium text-slate-700">
                Avg Detection Delay (sec)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={avgDelay}
                  onChange={(e) => setAvgDelay(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
              <label className="block font-medium text-slate-700">
                Speed Breakers Passed
                <input
                  type="number"
                  min={0}
                  value={breakersTested}
                  onChange={(e) => setBreakersTested(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
              <label className="block font-medium text-slate-700">
                Breakers Filtered Correctly
                <input
                  type="number"
                  min={0}
                  max={breakersTested}
                  value={breakersFiltered}
                  onChange={(e) => setBreakersFiltered(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </label>
            </div>

            <label className="block font-medium text-slate-700">
              Field Notes (weather, traffic, GPS drift)
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes from manual road walk / CNG test..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
            </label>

            {savedMsg && (
              <p role="status" className="font-semibold text-teal-700">
                {savedMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {saving ? 'Recording...' : 'Save Field Test Evaluation'}
            </button>
          </form>
        </section>
      </div>

      {/* Proposal Scope Limits & Team Reference */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">
            In Scope (Pilot Prototype)
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-slate-700">
            <li>Detect potholes, cracks, and distinguish speed breakers via simulated photo + vibration analysis.</li>
            <li>Check public-space telemetry: road waterlogging (&gt;15 cm), waste bin fill (&gt;85%), and street light status.</li>
            <li>Dhaka pilot corridor scope: Campus Main Rd and adjacent Ashulia/Birulia/Khagan roads with 3 sensor units (2 vehicle, 1 pole).</li>
            <li>10 m / 24 h duplicate merging and 2+ report confirmation workflow.</li>
            <li>Client-side Canvas privacy blurring before upload without face or plate recognition.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">
            Out of Scope (Explicit Exclusions)
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-slate-700">
            <li>Full Dhaka city-wide deployment or municipal ward coverage.</li>
            <li>Automatic repair crew dispatch or work-order payment systems.</li>
            <li>Direct integration with government databases (e.g., DNCC Shobar Dhaka).</li>
            <li>Face recognition or vehicle number-plate recognition (OCR).</li>
            <li>Heavy-duty weatherproof production hardware enclosures.</li>
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
            SE 231 System Analysis &amp; Design Capstone Project (Fall 2026) · Group 05 (Siam Sarder, Tabassum Islam, Khadiza Islam) · Department of Software Engineering, Daffodil International University.
          </p>
        </div>
      </section>
    </div>
  );
}
