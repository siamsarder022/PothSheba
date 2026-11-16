import React, { useState } from 'react';
import {
  Activity,
  CloudOff,
  Cpu,
  Database,
  Radio,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { AppStateResponse } from '../types/pothsheba.ts';
import type { SimulatedDetectionResult } from '../services/pothshebaEngine.ts';
import { apiClient } from '../services/apiClient.ts';

interface IotAndAiViewProps {
  data: AppStateResponse;
  onToggleDeviceConnection: (deviceId: string) => Promise<void>;
  onSimulateDeviceEvent: (
    deviceId: string,
    scenario: string,
    extra?: Record<string, unknown>
  ) => Promise<void>;
}

export function IotAndAiView({
  data,
  onToggleDeviceConnection,
  onSimulateDeviceEvent,
}: IotAndAiViewProps) {
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [ambientByDev, setAmbientByDev] = useState<Record<string, 'Clear Day' | 'Rain / Night'>>({
    'VEH-01': 'Clear Day',
    'VEH-02': 'Rain / Night',
  });
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  // Two-Method Detection Lab state
  const [labPeakG, setLabPeakG] = useState(2.65);
  const [labDurationMs, setLabDurationMs] = useState(115);
  const [labAmbient, setLabAmbient] = useState<'Clear Day' | 'Rain / Night'>('Clear Day');
  const [labHasPhoto, setLabHasPhoto] = useState(true);
  const [labResult, setLabResult] = useState<{
    simulated: boolean;
    note: string;
    analysis: SimulatedDetectionResult;
  } | null>(null);
  const [labRunning, setLabRunning] = useState(false);

  const handleToggle = async (devId: string) => {
    setBusyDeviceId(devId);
    setLastFeedback(null);
    try {
      await onToggleDeviceConnection(devId);
      setLastFeedback(`Updated connection state for ${devId}.`);
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleSimulate = async (
    devId: string,
    scenario: string,
    extra?: Record<string, unknown>
  ) => {
    setBusyDeviceId(devId);
    setLastFeedback(null);
    try {
      await onSimulateDeviceEvent(devId, scenario, extra);
      setLastFeedback(`Simulated "${scenario}" event on ${devId}. Check the event feed or Authority Map.`);
    } finally {
      setBusyDeviceId(null);
    }
  };

  const runDetectionLab = async () => {
    setLabRunning(true);
    try {
      const json = await apiClient.runAiInference({
        peakG: labPeakG,
        durationMs: labDurationMs,
        ambientCondition: labAmbient,
        hasPhoto: labHasPhoto,
      });
      setLabResult(json);
    } finally {
      setLabRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Honest Demo Simulation Notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">Simulated IoT &amp; AI Environment:</span>{' '}
        No physical ESP32 boards, live Mosquitto MQTT broker, or trained YOLO weights are connected. Actions below simulate device telemetry, offline flash buffering, and two-method detection through the server integration endpoints.
      </div>

      {lastFeedback && (
        <div
          role="status"
          className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-900"
        >
          {lastFeedback}
        </div>
      )}

      {/* 3 Sensor Devices Grid */}
      <section aria-label="Pilot sensor devices" className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Pilot Sensor Nodes &amp; Offline Queue Flow
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            2 vehicle-mounted units (ESP32 + ESP32-CAM + MPU6050 + NEO-6M GPS) and 1 fixed public-space pole unit (ESP32 + HC-SR04).
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {data.devices.map((dev) => {
            const isOffline = dev.status === 'Offline';
            const isBusy = busyDeviceId === dev.id;
            const ambient = ambientByDev[dev.id] ?? 'Clear Day';

            return (
              <article
                key={dev.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-tabular text-xs font-bold text-slate-500">
                          {dev.id}
                        </span>
                        <h2 className="text-lg font-bold text-slate-900">
                          {dev.name}
                        </h2>
                      </div>
                      <p className="text-xs text-slate-600">{dev.mountLabel}</p>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-semibold ${
                        isOffline
                          ? 'border-slate-300 bg-slate-100 text-slate-700'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {isOffline ? (
                        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {dev.status}
                    </span>
                  </div>

                  {/* Specs & Connectivity */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Hardware</span>
                      <span className="text-right font-medium text-slate-800">
                        {dev.hardwareStack.join(' · ')}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Transport</span>
                      <span className="font-medium text-slate-800">
                        {dev.connectivity} · {dev.protocols}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">MQTT Topic</span>
                      <span className="font-mono-tabular text-slate-700">
                        {dev.mqttTopic}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Location</span>
                      <span className="font-mono-tabular text-slate-800">
                        {dev.roadName} ({dev.lat.toFixed(4)}, {dev.lng.toFixed(4)})
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500">Last Seen</span>
                      <span className="font-mono-tabular text-slate-800">
                        {new Date(dev.lastSeenAt).toLocaleTimeString('en-GB')} · Battery {dev.batteryPct}%
                      </span>
                    </div>
                  </div>

                  {/* Latest Telemetry Readings */}
                  <div className="rounded-lg bg-slate-50 p-3 text-xs">
                    <div className="mb-1.5 font-semibold text-slate-700">
                      Latest Telemetry (Simulated)
                    </div>
                    {dev.category === 'vehicle' ? (
                      <div className="grid grid-cols-2 gap-2 font-mono-tabular text-slate-700">
                        <div>
                          Vibration: {dev.latestReadings.vibrationPeakG?.toFixed(2) ?? '—'} g
                        </div>
                        <div>
                          Speed: {dev.latestReadings.speedKmh?.toFixed(1) ?? '—'} km/h
                        </div>
                        <div>
                          GPS Sats: {dev.latestReadings.gpsSatellites ?? '—'} (±
                          {dev.latestReadings.gpsAccuracyM ?? '—'} m)
                        </div>
                        <div>Env: {ambient}</div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 font-mono-tabular text-slate-700">
                        <div>
                          Water: {dev.latestReadings.waterLevelCm ?? 0} cm
                        </div>
                        <div>
                          Bin Fill: {dev.latestReadings.binFillPct ?? 0}%
                        </div>
                        <div>
                          Street Light: {dev.latestReadings.streetLightState ?? 'On'}
                        </div>
                        <div>Threshold: 15 cm / 85%</div>
                      </div>
                    )}
                  </div>

                  {/* Offline Queue Box */}
                  <div className="rounded-lg border border-slate-200 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                        <CloudOff className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                        Offline Storage Queue
                      </span>
                      <span className="font-mono-tabular font-bold text-slate-900">
                        {dev.offlineQueue.length} buffered
                      </span>
                    </div>
                    {dev.offlineQueue.length === 0 ? (
                      <p className="mt-1 text-slate-500">
                        Queue empty. Toggle offline below to simulate signal loss buffering.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
                        {dev.offlineQueue.map((q) => (
                          <li key={q.queueId} className="font-mono-tabular">
                            {q.queueId} · {q.type} ({q.roadName})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Recent Device Events */}
                  <div>
                    <div className="mb-1 text-xs font-semibold text-slate-700">
                      Recent Device Log
                    </div>
                    <ul className="space-y-1 text-[11px] text-slate-600">
                      {dev.recentEvents.slice(0, 3).map((ev, idx) => (
                        <li key={idx} className="truncate" title={ev.summary}>
                          <span className="font-mono-tabular text-slate-400">
                            {new Date(ev.timestamp).toLocaleTimeString('en-GB', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>{' '}
                          · <strong className="text-slate-700">{ev.outcome}</strong>: {ev.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Device Simulation Controls */}
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleToggle(dev.id)}
                    className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      isOffline
                        ? 'bg-teal-700 text-white hover:bg-teal-800'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {isOffline
                        ? `Reconnect & Flush (${dev.offlineQueue.length}) Queued`
                        : 'Simulate Signal Loss (Go Offline)'}
                    </span>
                  </button>

                  {dev.category === 'vehicle' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>Ambient Condition:</span>
                        <select
                          value={ambient}
                          onChange={(e) =>
                            setAmbientByDev((prev) => ({
                              ...prev,
                              [dev.id]: e.target.value as 'Clear Day' | 'Rain / Night',
                            }))
                          }
                          aria-label={`Ambient condition for ${dev.name}`}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="Clear Day">Clear Day</option>
                          <option value="Rain / Night">Rain / Night</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleSimulate(dev.id, 'pothole', {
                              ambientCondition: ambient,
                            })
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          Trigger Pothole
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleSimulate(dev.id, 'corroborate_ps001', {
                              ambientCondition: ambient,
                            })
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          10m Merge Test
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleSimulate(dev.id, 'speed_breaker', {
                              ambientCondition: ambient,
                            })
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          Speed Breaker
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            handleSimulate(dev.id, 'minor_bump', {
                              ambientCondition: ambient,
                            })
                          }
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          Drop &lt; 1.5g
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleSimulate(dev.id, 'waterlogging', { waterLevelCm: 21 })
                        }
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Water 21cm
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleSimulate(dev.id, 'bin', { binFillPct: 94 })
                        }
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Bin 94%
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleSimulate(dev.id, 'light')}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                      >
                        Light Off
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Two-Method Road Detection Lab + Event Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-6">
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Two-Method Detection Analyzer (Simulated)
              </h2>
              <p className="text-xs text-slate-600">
                Tests how ESP32 edge filtering (&lt; 1.5g), simulated YOLO photo inference, and MPU6050 vibration patterns distinguish potholes from speed breakers and handle rain/night.
              </p>
            </div>
            <Cpu className="h-5 w-5 text-teal-700 shrink-0" aria-hidden="true" />
          </div>

          <div className="mt-4 space-y-4 text-xs">
            <label className="block font-medium text-slate-700">
              <div className="mb-1 flex justify-between">
                <span>MPU6050 Peak Vertical Acceleration</span>
                <span className="font-mono-tabular font-semibold">
                  {labPeakG.toFixed(2)} g
                </span>
              </div>
              <input
                type="range"
                min={0.9}
                max={3.8}
                step={0.05}
                value={labPeakG}
                onChange={(e) => setLabPeakG(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </label>

            <label className="block font-medium text-slate-700">
              <div className="mb-1 flex justify-between">
                <span>Vibration Impulse Duration</span>
                <span className="font-mono-tabular font-semibold">
                  {labDurationMs} ms
                </span>
              </div>
              <input
                type="range"
                min={60}
                max={350}
                step={5}
                value={labDurationMs}
                onChange={(e) => setLabDurationMs(Number(e.target.value))}
                className="w-full accent-teal-700"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block font-medium text-slate-700">
                Ambient Visibility
                <select
                  value={labAmbient}
                  onChange={(e) =>
                    setLabAmbient(e.target.value as 'Clear Day' | 'Rain / Night')
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="Clear Day">Clear Day</option>
                  <option value="Rain / Night">Rain / Night (reduced camera clarity)</option>
                </select>
              </label>

              <label className="flex items-center gap-2 pt-5 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={labHasPhoto}
                  onChange={(e) => setLabHasPhoto(e.target.checked)}
                  className="accent-teal-700"
                />
                <span>ESP32-CAM frame captured</span>
              </label>
            </div>

            <button
              type="button"
              disabled={labRunning}
              onClick={runDetectionLab}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {labRunning
                ? 'Running Simulated Pipeline...'
                : 'Run Simulated Two-Method Classification'}
            </button>

            {labResult && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Result: {labResult.analysis.passedQuickCheck ? labResult.analysis.classifiedType : 'Dropped on Device'}
                  </span>
                  <span className="font-mono-tabular text-[11px] font-semibold text-amber-800">
                    Simulated Inference
                  </span>
                </div>
                <p className="text-slate-700">{labResult.analysis.explanation}</p>
                <div className="grid grid-cols-3 gap-2 font-mono-tabular text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>YOLO (Sim): {(labResult.analysis.yoloConfidence * 100).toFixed(0)}%</div>
                  <div>Vibration: {(labResult.analysis.vibrationConfidence * 100).toFixed(0)}%</div>
                  <div>Combined: {(labResult.analysis.combinedConfidence * 100).toFixed(0)}%</div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* System Event Feed + Integration Boundaries */}
        <div className="space-y-4 lg:col-span-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-base font-bold text-slate-900">
                Pipeline Event Feed
              </h2>
              <Activity className="h-4 w-4 text-slate-500" aria-hidden="true" />
            </div>
            <ul className="max-h-56 space-y-2 overflow-y-auto text-xs">
              {data.eventLog.slice(0, 15).map((ev, idx) => (
                <li
                  key={idx}
                  className="flex gap-2 border-b border-slate-100 pb-1.5 last:border-0"
                >
                  <span className="font-mono-tabular text-slate-400 shrink-0">
                    {new Date(ev.timestamp).toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="text-slate-700">
                    <strong className="text-slate-900">{ev.source}:</strong>{' '}
                    {ev.message}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-base font-bold text-slate-900">
                Service &amp; Integration Status
              </h2>
              <Database className="h-4 w-4 text-slate-500" aria-hidden="true" />
            </div>
            <div className="space-y-2.5 text-xs">
              {Object.entries(data.integrationReadiness).map(([key, item]) => (
                <div key={key} className="border-b border-slate-100 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 capitalize">
                      {key.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono-tabular text-[11px] font-medium text-slate-700">
                      <Radio className="h-3 w-3 text-teal-700" aria-hidden="true" />
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
