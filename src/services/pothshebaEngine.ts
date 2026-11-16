import type {
  DetectionMethod,
  IssueSource,
  IssueType,
  PilotLandmark,
  PilotRoadCorridor,
  PriorityWeights,
  RoadIssue,
  SeverityLevel,
} from '../types/pothsheba.ts';

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  size: 0.4,
  traffic: 0.3,
  risk: 0.3,
};

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistanceMeters(
  lat: number,
  lng: number,
  a: [number, number],
  b: [number, number]
): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const px = lng * 111320 * cosLat;
  const py = lat * 110540;
  const ax = a[1] * 111320 * cosLat;
  const ay = a[0] * 110540;
  const bx = b[1] * 111320 * cosLat;
  const by = b[0] * 110540;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function inferRoadContext(
  lat: number,
  lng: number,
  roads: PilotRoadCorridor[],
  landmarks: PilotLandmark[]
): {
  roadName: string;
  trafficScore: number;
  trafficLabel: string;
  nearestLandmark: string;
  distanceToLandmarkM: number;
  riskScore: number;
  riskReason: string;
} {
  let closestRoad = roads[0];
  let minRoadDist = Infinity;

  for (const road of roads) {
    for (let i = 1; i < road.coordinates.length; i++) {
      const d = pointToSegmentDistanceMeters(
        lat,
        lng,
        road.coordinates[i - 1],
        road.coordinates[i]
      );
      if (d < minRoadDist) {
        minRoadDist = d;
        closestRoad = road;
      }
    }
  }

  let nearestLm = landmarks[0];
  let minLmDist = Infinity;
  for (const lm of landmarks) {
    const d = haversineMeters(lat, lng, lm.lat, lm.lng);
    if (d < minLmDist) {
      minLmDist = d;
      nearestLm = lm;
    }
  }

  const distRounded = Math.round(minLmDist);
  let riskScore = 20;
  let riskReason = `Standard corridor exposure (${distRounded} m from ${nearestLm.name})`;
  if (distRounded <= 90) {
    riskScore = 95;
    riskReason = `Within ${distRounded} m of ${nearestLm.kind} (${nearestLm.name})`;
  } else if (distRounded <= 180) {
    riskScore = 70;
    riskReason = `Near ${nearestLm.kind} (${nearestLm.name}, ${distRounded} m)`;
  } else if (distRounded <= 300) {
    riskScore = 45;
    riskReason = `Moderate pedestrian zone (${distRounded} m from ${nearestLm.name})`;
  }

  return {
    roadName: closestRoad.name,
    trafficScore: closestRoad.trafficScore,
    trafficLabel: closestRoad.trafficLabel,
    nearestLandmark: `${nearestLm.name} (${nearestLm.kind})`,
    distanceToLandmarkM: distRounded,
    riskScore,
    riskReason,
  };
}

export function severityFromScore(score: number): SeverityLevel {
  if (score >= 75) return 'Critical';
  if (score >= 55) return 'High';
  if (score >= 35) return 'Medium';
  return 'Low';
}

export function computePriorityScore(
  issue: Pick<
    RoadIssue,
    | 'type'
    | 'sizeScore'
    | 'trafficScore'
    | 'riskScore'
    | 'roadName'
    | 'nearestLandmark'
    | 'distanceToLandmarkM'
    | 'confirmationCount'
  >,
  weights: PriorityWeights
): {
  priorityScore: number;
  severity: SeverityLevel;
  scoreReasons: string[];
} {
  const totalWeight = weights.size + weights.traffic + weights.risk || 1;
  const wSize = weights.size / totalWeight;
  const wTraffic = weights.traffic / totalWeight;
  const wRisk = weights.risk / totalWeight;

  const raw =
    wSize * issue.sizeScore +
    wTraffic * issue.trafficScore +
    wRisk * issue.riskScore;
  const priorityScore = clamp(Math.round(raw), 0, 100);
  const severity = severityFromScore(priorityScore);

  const sizeDescriptor =
    issue.sizeScore >= 75
      ? 'Severe surface/capacity impact'
      : issue.sizeScore >= 50
      ? 'Moderate physical footprint'
      : 'Minor localized size';

  const scoreReasons = [
    `Size ${Math.round(issue.sizeScore)}/100 (weight ${wSize.toFixed(2)}): ${sizeDescriptor} for ${issue.type.toLowerCase()}`,
    `Traffic ${Math.round(issue.trafficScore)}/100 (weight ${wTraffic.toFixed(2)}): ${issue.roadName} corridor load`,
    `Risk ${Math.round(issue.riskScore)}/100 (weight ${wRisk.toFixed(2)}): ${issue.distanceToLandmarkM} m from ${issue.nearestLandmark}`,
  ];

  if (issue.confirmationCount >= 2) {
    scoreReasons.push(
      `Confirmed by ${issue.confirmationCount} independent reports (meets 2+ corroboration rule)`
    );
  } else {
    scoreReasons.push(
      `Awaiting second corroborating report (currently ${issue.confirmationCount} report)`
    );
  }

  return { priorityScore, severity, scoreReasons };
}

export interface SimulatedDetectionInput {
  peakG: number;
  durationMs: number;
  ambientCondition: 'Clear Day' | 'Rain / Night';
  hasPhoto: boolean;
  isSpeedBreakerGroundTruth?: boolean;
}

export interface SimulatedDetectionResult {
  passedQuickCheck: boolean;
  classifiedType: IssueType;
  isDefect: boolean;
  yoloConfidence: number;
  vibrationConfidence: number;
  combinedConfidence: number;
  detectionMethod: DetectionMethod;
  explanation: string;
}

/**
 * Simulates the proposal's two-step ESP32 edge check + two-method AI detection:
 * 1) Quick check: drops vibration events < 1.5g locally.
 * 2) Photo (YOLO-style) + MPU6050 vibration pattern discrimination:
 *    - Speed breakers have a wider, smoother hump duration (>= 220 ms) and moderate G.
 *    - Potholes produce sharp, high-kurtosis impacts (< 200 ms) with higher Z-axis spikes.
 *    - Rain/Night degrades photo confidence, shifting reliance to vibration.
 */
export function analyzeSimulatedRoadEvent(
  input: SimulatedDetectionInput
): SimulatedDetectionResult {
  if (input.peakG < 1.5) {
    return {
      passedQuickCheck: false,
      classifiedType: 'Pothole',
      isDefect: false,
      yoloConfidence: 0,
      vibrationConfidence: 0.12,
      combinedConfidence: 0.12,
      detectionMethod: 'MPU6050 Vibration',
      explanation: `Dropped on ESP32 edge filter: peak ${input.peakG.toFixed(2)}g is below the 1.50g threshold (saves battery and mobile data).`,
    };
  }

  const looksLikeBreaker =
    input.isSpeedBreakerGroundTruth === true ||
    (input.durationMs >= 220 && input.peakG <= 2.45);

  const rawPhoto = input.hasPhoto
    ? looksLikeBreaker
      ? 0.42
      : 0.84
    : 0;
  const yoloConfidence = Number(
    (input.ambientCondition === 'Rain / Night' ? rawPhoto * 0.62 : rawPhoto).toFixed(2)
  );

  const vibrationConfidence = Number(
    clamp(
      (input.peakG - 1.2) / 2.4,
      0.2,
      0.96
    ).toFixed(2)
  );

  if (looksLikeBreaker) {
    return {
      passedQuickCheck: true,
      classifiedType: 'Speed breaker',
      isDefect: false,
      yoloConfidence,
      vibrationConfidence,
      combinedConfidence: Number(((yoloConfidence * 0.4 + vibrationConfidence * 0.6)).toFixed(2)),
      detectionMethod: input.hasPhoto ? 'Photo + Vibration' : 'MPU6050 Vibration',
      explanation: `Vibration signature (${input.peakG.toFixed(2)}g over ${input.durationMs} ms) matches a wide speed breaker hump rather than a sharp pothole impact. Classified as Speed breaker (non-defect).`,
    };
  }

  const photoWeight = input.ambientCondition === 'Rain / Night' ? 0.35 : 0.6;
  const vibWeight = 1 - photoWeight;
  const combinedConfidence = Number(
    (
      (input.hasPhoto ? yoloConfidence * photoWeight : 0) +
      vibrationConfidence * (input.hasPhoto ? vibWeight : 1)
    ).toFixed(2)
  );

  const detectionMethod: DetectionMethod = !input.hasPhoto
    ? 'MPU6050 Vibration'
    : input.ambientCondition === 'Rain / Night'
    ? 'Photo + Vibration'
    : 'YOLO Photo (Simulated)';

  return {
    passedQuickCheck: true,
    classifiedType: 'Pothole',
    isDefect: true,
    yoloConfidence,
    vibrationConfidence,
    combinedConfidence,
    detectionMethod,
    explanation:
      input.ambientCondition === 'Rain / Night'
        ? `Rain/night mode reduced simulated YOLO confidence to ${(yoloConfidence * 100).toFixed(0)}%; MPU6050 vibration (${input.peakG.toFixed(2)}g, ${input.durationMs} ms) confirmed road surface shock.`
        : `Simulated YOLO photo (${(yoloConfidence * 100).toFixed(0)}%) and MPU6050 vibration (${input.peakG.toFixed(2)}g, ${input.durationMs} ms) indicate a pothole impact.`,
  };
}

export interface IncomingReportPayload {
  type: IssueType;
  lat: number;
  lng: number;
  sizeScore: number;
  source: IssueSource;
  deviceId?: string;
  reporterLabel: string;
  detectionMethod: DetectionMethod;
  note: string;
  photoDataUrl?: string;
  privacyBlurApplied?: boolean;
  privacyBlurMethod?: 'Manual Canvas Blur' | 'Simulated Auto-Blur Preview' | 'None';
  vibrationPeakG?: number;
  vibrationDurationMs?: number;
  yoloConfidence?: number;
  forceConfirm?: boolean;
  isSimulated?: boolean;
}

/**
 * Merges reports of the same issue type within ~10 m and 24 hours.
 * Keeps vehicle/citizen issues Unconfirmed until 2+ supporting reports match.
 */
export function mergeOrCreateIssue(
  existingIssues: RoadIssue[],
  payload: IncomingReportPayload,
  roads: PilotRoadCorridor[],
  landmarks: PilotLandmark[],
  weights: PriorityWeights,
  nextIdNumber: number
): {
  issue: RoadIssue;
  merged: boolean;
  newlyConfirmed: boolean;
  nextIdNumber: number;
} {
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  const match = existingIssues.find((item) => {
    if (item.status === 'Resolved') return false;
    if (item.type !== payload.type) return false;
    const ageMs = nowMs - new Date(item.createdAt).getTime();
    if (ageMs > TWENTY_FOUR_HOURS_MS) return false;
    const dist = haversineMeters(item.lat, item.lng, payload.lat, payload.lng);
    return dist <= 10.5; // ~10 meter merge threshold from proposal
  });

  const evidenceId = `EV-${nowMs.toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;
  const newEvidence = {
    id: evidenceId,
    timestamp: nowIso,
    source: payload.source,
    deviceId: payload.deviceId,
    reporterLabel: payload.reporterLabel,
    detectionMethod: payload.detectionMethod,
    note: payload.note,
    photoDataUrl: payload.photoDataUrl,
    privacyBlurApplied: Boolean(payload.privacyBlurApplied),
    privacyBlurMethod: payload.privacyBlurMethod ?? 'None',
    vibrationPeakG: payload.vibrationPeakG,
    vibrationDurationMs: payload.vibrationDurationMs,
    yoloConfidence: payload.yoloConfidence,
  };

  if (match) {
    const prevCount = match.confirmationCount;
    const nextCount = prevCount + 1;
    match.lat = Number(((match.lat * prevCount + payload.lat) / nextCount).toFixed(6));
    match.lng = Number(((match.lng * prevCount + payload.lng) / nextCount).toFixed(6));
    match.confirmationCount = nextCount;
    match.sizeScore = Math.max(match.sizeScore, payload.sizeScore);

    if (!match.sources.includes(payload.source)) {
      match.sources.push(payload.source);
    }
    if (!match.detectionMethods.includes(payload.detectionMethod)) {
      match.detectionMethods.push(payload.detectionMethod);
    }
    if (payload.vibrationPeakG != null) {
      match.vibrationPeakG = Math.max(match.vibrationPeakG ?? 0, payload.vibrationPeakG);
    }
    if (payload.yoloConfidence != null) {
      match.aiConfidence = Math.max(match.aiConfidence ?? 0, payload.yoloConfidence);
    }

    match.evidenceReports.unshift(newEvidence);
    match.updatedAt = nowIso;

    let newlyConfirmed = false;
    if (match.status === 'Unconfirmed' && (nextCount >= 2 || payload.forceConfirm)) {
      match.status = 'Confirmed';
      newlyConfirmed = true;
      match.history.push({
        timestamp: nowIso,
        actor: 'System Merge Engine',
        action: 'Auto-Confirmed (2+ Reports)',
        detail: `Merged within 10 m & 24 h (${nextCount} supporting reports).`,
      });
    } else {
      match.history.push({
        timestamp: nowIso,
        actor: payload.deviceId ? `Device ${payload.deviceId}` : payload.reporterLabel,
        action: 'Merged Supporting Report',
        detail: payload.note || `Corroborated existing ${match.type} report.`,
      });
    }

    const ctx = inferRoadContext(match.lat, match.lng, roads, landmarks);
    match.roadName = ctx.roadName;
    match.nearestLandmark = ctx.nearestLandmark;
    match.distanceToLandmarkM = ctx.distanceToLandmarkM;
    match.trafficScore = ctx.trafficScore;
    match.riskScore = ctx.riskScore;

    const scored = computePriorityScore(match, weights);
    match.priorityScore = scored.priorityScore;
    match.severity = scored.severity;
    match.scoreReasons = scored.scoreReasons;

    return { issue: match, merged: true, newlyConfirmed, nextIdNumber };
  }

  const ctx = inferRoadContext(payload.lat, payload.lng, roads, landmarks);
  const id = `PS-${String(nextIdNumber).padStart(3, '0')}`;
  const isConfirmed = Boolean(payload.forceConfirm);

  const draft: RoadIssue = {
    id,
    type: payload.type,
    status: isConfirmed ? 'Confirmed' : 'Unconfirmed',
    severity: 'Medium',
    priorityScore: 50,
    lat: Number(payload.lat.toFixed(6)),
    lng: Number(payload.lng.toFixed(6)),
    roadName: ctx.roadName,
    nearestLandmark: ctx.nearestLandmark,
    distanceToLandmarkM: ctx.distanceToLandmarkM,
    sizeScore: clamp(payload.sizeScore, 10, 100),
    trafficScore: ctx.trafficScore,
    riskScore: ctx.riskScore,
    scoreReasons: [],
    confirmationCount: 1,
    sources: [payload.source],
    detectionMethods: [payload.detectionMethod],
    isSimulated: Boolean(payload.isSimulated),
    aiSummary:
      payload.source === 'Citizen report'
        ? `[Simulated AI Triage] Citizen-submitted ${payload.type.toLowerCase()} on ${ctx.roadName}; prioritized using size estimate, corridor traffic (${ctx.trafficScore}), and proximity to ${ctx.nearestLandmark}.`
        : `[Simulated AI Summary] Detected ${payload.type.toLowerCase()} via ${payload.detectionMethod} on ${ctx.roadName}. ${isConfirmed ? 'Confirmed by fixed/officer rule.' : 'Marked Unconfirmed pending 2nd vehicle/citizen match.'}`,
    aiConfidence: payload.yoloConfidence,
    vibrationPeakG: payload.vibrationPeakG,
    vibrationDurationMs: payload.vibrationDurationMs,
    evidenceReports: [newEvidence],
    assignedWorker: null,
    officerNotes: '',
    resolutionNotes: '',
    history: [
      {
        timestamp: nowIso,
        actor: payload.deviceId ? `Device ${payload.deviceId}` : payload.reporterLabel,
        action: isConfirmed ? 'Reported & Confirmed' : 'Reported (Unconfirmed)',
        detail: payload.note || `${payload.type} logged on ${ctx.roadName}.`,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const scored = computePriorityScore(draft, weights);
  draft.priorityScore = scored.priorityScore;
  draft.severity = scored.severity;
  draft.scoreReasons = scored.scoreReasons;

  existingIssues.unshift(draft);
  return {
    issue: draft,
    merged: false,
    newlyConfirmed: isConfirmed,
    nextIdNumber: nextIdNumber + 1,
  };
}
