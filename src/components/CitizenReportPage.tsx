import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Crosshair,
  Eraser,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  ISSUE_TYPES,
  type AppStateResponse,
  type AuthUser,
  type IssueType,
  type PrivacyBlurMethod,
  type RoadIssue,
  type WorkflowStatus,
} from '../types/pothsheba.ts';
import { PilotMap } from './PilotMap.tsx';
import { SeverityIndicator, StatusIndicator } from './SeverityBadge.tsx';
import { apiClient } from '../services/apiClient.ts';

interface CitizenReportPageProps {
  data: AppStateResponse;
  authUser?: AuthUser | null;
  serverReportIds?: string[];
  onReportSubmitted: (payload: {
    type: IssueType;
    lat: number;
    lng: number;
    sizeScore: number;
    note: string;
    photoDataUrl?: string;
    privacyBlurApplied: boolean;
    privacyBlurMethod: PrivacyBlurMethod;
  }) => Promise<{ issue: RoadIssue; merged: boolean; newlyConfirmed: boolean }>;
}

interface TrackedReportStatus {
  id: string;
  type: IssueType;
  status: WorkflowStatus;
  severity: RoadIssue['severity'];
  priorityScore: number;
  roadName: string;
  confirmationCount: number;
  assignedWorker: string | null;
  resolutionNotes: string;
  updatedAt: string;
  createdAt: string;
  history: RoadIssue['history'];
}

export function CitizenReportPage({
  data,
  authUser = null,
  serverReportIds = [],
  onReportSubmitted,
}: CitizenReportPageProps) {
  const [pickedLocation, setPickedLocation] = useState<[number, number] | null>(null);
  const [gpsStatus, setGpsStatus] = useState<string>('');
  const [issueType, setIssueType] = useState<IssueType>('Pothole');
  const [sizeScore, setSizeScore] = useState<number>(65);
  const [description, setDescription] = useState<string>('');

  // Photo & Canvas Privacy Blur state
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [blurCount, setBlurCount] = useState<number>(0);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Camera capture state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Submission & Tracking state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    id: string;
    merged: boolean;
    newlyConfirmed: boolean;
    status: WorkflowStatus;
    confirmationCount: number;
  } | null>(null);

  const [mySubmittedIds, setMySubmittedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ps_citizen_refs');
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [trackQuery, setTrackQuery] = useState('');
  const [tracked, setTracked] = useState<TrackedReportStatus | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Draw original image onto canvas whenever originalImageUrl changes
  useEffect(() => {
    if (!originalImageUrl || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = 640;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      setBlurCount(0);
    };
    img.src = originalImageUrl;
  }, [originalImageUrl]);

  // Stop camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleUseDeviceGps = () => {
    if (!navigator.geolocation) {
      setGpsStatus('Geolocation is not supported in this browser. Tap the map instead.');
      return;
    }
    setGpsStatus('Requesting device location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setPickedLocation([lat, lng]);
        setGpsStatus(
          `Device location captured (${lat.toFixed(5)}, ${lng.toFixed(5)}, ±${Math.round(pos.coords.accuracy)} m).`
        );
      },
      (err) => {
        setGpsStatus(
          err.code === 1
            ? 'Location permission denied. Tap the Dhaka pilot map to place a marker.'
            : `Could not read device GPS (${err.message}). Tap the map instead.`
        );
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const handleFileChange = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSubmitError('Please select a valid image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setOriginalImageUrl(reader.result);
        setSubmitError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera access is unavailable here. Use Upload Photo instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setCameraError('Camera permission denied or unavailable. Please upload a photo file.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const captureCameraFrame = () => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth) return;
    const tempCanvas = document.createElement('canvas');
    const scale = Math.min(1, 800 / vid.videoWidth);
    tempCanvas.width = Math.round(vid.videoWidth * scale);
    tempCanvas.height = Math.round(vid.videoHeight * scale);
    const ctx = tempCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(vid, 0, 0, tempCanvas.width, tempCanvas.height);
      setOriginalImageUrl(tempCanvas.toDataURL('image/jpeg', 0.85));
    }
    stopCamera();
  };

  // Real client-side Canvas pixelation blur over user-selected rectangles
  const applyPixelBlurRect = (x0: number, y0: number, x1: number, y1: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rx = Math.max(0, Math.min(x0, x1));
    const ry = Math.max(0, Math.min(y0, y1));
    const rw = Math.min(canvas.width - rx, Math.abs(x1 - x0));
    const rh = Math.min(canvas.height - ry, Math.abs(y1 - y0));

    if (rw < 8 || rh < 8) return;

    const blockSize = 10;
    const imgData = ctx.getImageData(rx, ry, rw, rh);
    const dataArr = imgData.data;

    for (let y = 0; y < rh; y += blockSize) {
      for (let x = 0; x < rw; x += blockSize) {
        const px = Math.min(x + Math.floor(blockSize / 2), rw - 1);
        const py = Math.min(y + Math.floor(blockSize / 2), rh - 1);
        const idx = (py * rw + px) * 4;
        const r = dataArr[idx];
        const g = dataArr[idx + 1];
        const b = dataArr[idx + 2];

        for (let dy = 0; dy < blockSize && y + dy < rh; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < rw; dx++) {
            const targetIdx = ((y + dy) * rw + (x + dx)) * 4;
            dataArr[targetIdx] = r;
            dataArr[targetIdx + 1] = g;
            dataArr[targetIdx + 2] = b;
          }
        }
      }
    }

    ctx.putImageData(imgData, rx, ry);
    setBlurCount((c) => c + 1);
  };

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const handleResetPhotoBlur = () => {
    if (!originalImageUrl || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      setBlurCount(0);
    };
    img.src = originalImageUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!pickedLocation) {
      setSubmitError('Please tap the map or use your device GPS to select the issue location.');
      return;
    }

    setSubmitting(true);
    try {
      const photoDataUrl =
        originalImageUrl && canvasRef.current
          ? canvasRef.current.toDataURL('image/jpeg', 0.82)
          : undefined;

      const result = await onReportSubmitted({
        type: issueType,
        lat: pickedLocation[0],
        lng: pickedLocation[1],
        sizeScore,
        note: description.trim() || `Citizen reported ${issueType.toLowerCase()}.`,
        photoDataUrl,
        privacyBlurApplied: Boolean(photoDataUrl && blurCount > 0),
        privacyBlurMethod:
          photoDataUrl && blurCount > 0 ? 'Manual Canvas Blur' : 'None',
      });

      setReceipt({
        id: result.issue.id,
        merged: result.merged,
        newlyConfirmed: result.newlyConfirmed,
        status: result.issue.status,
        confirmationCount: result.issue.confirmationCount,
      });

      const updatedRefs = [
        result.issue.id,
        ...mySubmittedIds.filter((id) => id !== result.issue.id),
      ].slice(0, 8);
      setMySubmittedIds(updatedRefs);
      try {
        localStorage.setItem('ps_citizen_refs', JSON.stringify(updatedRefs));
      } catch {
        // ignore storage quota errors
      }

      setTrackQuery(result.issue.id);
      await fetchTrackedStatus(result.issue.id);

      // Reset form inputs
      setDescription('');
      setOriginalImageUrl(null);
      setBlurCount(0);
      setPickedLocation(null);
      setGpsStatus('');
    } catch {
      setSubmitError('Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchTrackedStatus = async (refId: string) => {
    const clean = refId.trim().toUpperCase();
    if (!clean) return;
    setTrackingLoading(true);
    setTrackError(null);
    try {
      const json = await apiClient.trackReportStatus(clean);
      if (!json) {
        setTracked(null);
        setTrackError(`No report found for reference ID "${clean}".`);
        return;
      }
      setTracked(json as TrackedReportStatus);
    } catch {
      setTrackError('Could not fetch report status.');
    } finally {
      setTrackingLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">
          Report a Road or Public-Space Problem
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Submit a local issue within the Dhaka pilot corridor. Your personal identity is never published on the public map.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Interactive Map Picker */}
        <div className="space-y-3 lg:col-span-7">
          <PilotMap
            center={data.pilotMeta.center}
            roads={data.pilotMeta.roads}
            landmarks={data.pilotMeta.landmarks}
            issues={data.issues.filter((i) => i.status !== 'Resolved')}
            devices={[]}
            pickMode
            pickedLocation={pickedLocation}
            onPickLocation={(lat, lng) => {
              setPickedLocation([lat, lng]);
              setGpsStatus(`Map marker placed at ${lat.toFixed(5)}, ${lng.toFixed(5)}.`);
            }}
            heightClass="h-[460px]"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
            <div className="text-slate-600">
              {pickedLocation ? (
                <span>
                  Selected coordinates:{' '}
                  <strong className="font-mono-tabular text-slate-900">
                    {pickedLocation[0].toFixed(5)}, {pickedLocation[1].toFixed(5)}
                  </strong>
                </span>
              ) : (
                <span>Tap anywhere on the map or use device GPS to set location.</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleUseDeviceGps}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Crosshair className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                <span>Use My Location</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPickedLocation([23.87681, 90.31911]);
                  setGpsStatus(
                    'Placed marker within 5 m of PS-001 (Campus Gate) to demonstrate 10 m duplicate merging.'
                  );
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
              >
                <span>Test 10m Merge Near Gate</span>
              </button>
            </div>
          </div>
          {gpsStatus && (
            <p role="status" className="text-xs font-medium text-teal-800 px-1">
              {gpsStatus}
            </p>
          )}
        </div>

        {/* Right: Report Form & Tracker */}
        <div className="space-y-6 lg:col-span-5">
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
          >
            <h2 className="text-base font-bold text-slate-900">
              Issue Details &amp; Privacy-Safe Photo
            </h2>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Issue Category
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value as IssueType)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-slate-700">
                Estimated Impact / Size
                <select
                  value={sizeScore}
                  onChange={(e) => setSizeScore(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value={35}>Small / Minor (35)</option>
                  <option value={65}>Medium / Moderate (65)</option>
                  <option value={90}>Large / Hazardous (90)</option>
                </select>
              </label>
            </div>

            <label className="block text-xs font-medium text-slate-700">
              Description
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Water-filled pothole near school gate, hard for rickshaws to pass"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>

            {/* Photo & Privacy Blur Section */}
            <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <ShieldCheck className="h-4 w-4 text-teal-700" aria-hidden="true" />
                  <span>Photo &amp; Face/Plate Privacy Blur</span>
                </span>
                {originalImageUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalImageUrl(null);
                      setBlurCount(0);
                    }}
                    className="text-xs font-semibold text-red-700 hover:underline"
                  >
                    Remove photo
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Upload Photo</span>
                </button>
                <button
                  type="button"
                  onClick={cameraOpen ? stopCamera : startCamera}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{cameraOpen ? 'Close Camera' : 'Take Photo'}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                />
              </div>

              {cameraError && (
                <p className="text-xs text-amber-800">{cameraError}</p>
              )}

              {cameraOpen && (
                <div className="space-y-2">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-h-52 rounded-lg bg-slate-900 object-cover"
                  />
                  <button
                    type="button"
                    onClick={captureCameraFrame}
                    className="w-full rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                  >
                    Capture Frame
                  </button>
                </div>
              )}

              {originalImageUrl && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>Click &amp; drag over faces or license plates to pixelate before saving:</span>
                    {blurCount > 0 && (
                      <button
                        type="button"
                        onClick={handleResetPhotoBlur}
                        className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline"
                      >
                        <Eraser className="h-3 w-3" aria-hidden="true" />
                        Reset
                      </button>
                    )}
                  </div>
                  <canvas
                    ref={canvasRef}
                    onPointerDown={(e) => setDragStart(getCanvasPoint(e))}
                    onPointerUp={(e) => {
                      if (dragStart) {
                        const end = getCanvasPoint(e);
                        applyPixelBlurRect(dragStart.x, dragStart.y, end.x, end.y);
                        setDragStart(null);
                      }
                    }}
                    className="w-full cursor-crosshair rounded-lg border border-slate-300 bg-white touch-none"
                  />
                  <p className="text-[11px] leading-relaxed text-slate-600">
                    {blurCount > 0
                      ? `Local Canvas blur applied to ${blurCount} region(s). Visually confirm all faces and plates are covered; no automatic face or plate recognition is performed.`
                      : 'No blur applied yet. Automatic face/number-plate detection is unavailable in this prototype; do not assume this image is anonymized unless you blur sensitive areas above.'}
                  </p>
                </div>
              )}
            </div>

            {submitError && (
              <p role="alert" className="text-xs font-semibold text-red-700">
                {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting Report...' : 'Submit Report'}
            </button>

            {receipt && (
              <div
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900 space-y-1"
              >
                <div className="flex items-center gap-1.5 font-bold text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Report Reference: <span className="font-mono-tabular">{receipt.id}</span>
                  </span>
                </div>
                <p>
                  {receipt.merged
                    ? `Merged with an existing report within 10 m and 24 hours (${receipt.confirmationCount} supporting reports).`
                    : 'Logged as a new pilot issue.'}{' '}
                  Current state: <strong>{receipt.status}</strong>
                  {receipt.newlyConfirmed ? ' (Now Confirmed!)' : '.'}
                </p>
              </div>
            )}
          </form>

          {/* Report Status Tracker */}
          <section
            aria-label="Track submitted report"
            className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
          >
            <h2 className="text-base font-bold text-slate-900">
              Track Report Status
            </h2>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchTrackedStatus(trackQuery);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={trackQuery}
                onChange={(e) => setTrackQuery(e.target.value)}
                placeholder="Enter Reference ID (e.g. PS-001)"
                aria-label="Report reference ID"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono-tabular uppercase"
              />
              <button
                type="submit"
                disabled={trackingLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Check</span>
              </button>
            </form>

            {(authUser ? Array.from(new Set([...serverReportIds, ...mySubmittedIds])) : mySubmittedIds).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">
                  {authUser ? 'Your Reports:' : 'Recent:'}
                </span>
                {(authUser
                  ? Array.from(new Set([...serverReportIds, ...mySubmittedIds]))
                  : mySubmittedIds
                ).map((refId) => (
                  <button
                    key={refId}
                    type="button"
                    onClick={() => {
                      setTrackQuery(refId);
                      fetchTrackedStatus(refId);
                    }}
                    className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono-tabular font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {refId}
                  </button>
                ))}
              </div>
            )}

            {trackError && (
              <p role="alert" className="text-xs text-red-700">
                {trackError}
              </p>
            )}

            {tracked && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono-tabular text-sm font-bold text-slate-900">
                    {tracked.id} · {tracked.type}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <SeverityIndicator severity={tracked.severity} compact />
                    <StatusIndicator status={tracked.status} />
                  </div>
                </div>
                <div className="text-slate-600">
                  {tracked.roadName} · {tracked.confirmationCount} supporting report(s)
                  {tracked.assignedWorker ? ` · ${tracked.assignedWorker}` : ''}
                </div>
                {tracked.resolutionNotes && (
                  <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
                    Resolution: {tracked.resolutionNotes}
                  </p>
                )}
                <ul className="space-y-1 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
                  {tracked.history.map((h, idx) => (
                    <li key={idx}>
                      <span className="font-mono-tabular text-slate-400">
                        {new Date(h.timestamp).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>{' '}
                      · <strong>{h.action}</strong>: {h.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
