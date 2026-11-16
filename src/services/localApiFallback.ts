import type {
  AppStateResponse,
  AuthSessionResponse,
  AuthUser,
  EvaluationRun,
  IssueType,
  PriorityWeights,
  PrivacyBlurMethod,
  RoadIssue,
  SensorDevice,
  UserRole,
  WorkflowStatus,
} from '../types/pothsheba.ts';
import {
  analyzeSimulatedRoadEvent,
  computePriorityScore,
  DEFAULT_PRIORITY_WEIGHTS,
  mergeOrCreateIssue,
  type SimulatedDetectionResult,
} from './pothshebaEngine.ts';
import {
  createSeedDevices,
  createSeedEvaluationRuns,
  createSeedIssues,
  PILOT_CENTER,
  PILOT_LANDMARKS,
  PILOT_ROADS,
} from '../data/pilotSeed.ts';

const STATE_KEY = 'ps_local_fallback_state_v1';
const AUTH_KEY = 'ps_local_fallback_auth_v1';

interface LocalState {
  nextIssueNum: number;
  issues: RoadIssue[];
  devices: SensorDevice[];
  weights: PriorityWeights;
  evaluationRuns: EvaluationRun[];
  eventLog: { timestamp: string; source: string; message: string }[];
}

interface LocalUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface LocalAuthDb {
  users: LocalUser[];
  sessions: Record<string, string>; // token -> userId
  ownership: Record<string, string[]>; // userId -> issueIds
}

function makeInitialState(): LocalState {
  return {
    nextIssueNum: 8,
    issues: createSeedIssues(),
    devices: createSeedDevices(),
    weights: { ...DEFAULT_PRIORITY_WEIGHTS },
    evaluationRuns: createSeedEvaluationRuns(),
    eventLog: [
      {
        timestamp: new Date().toISOString(),
        source: 'Local Fallback',
        message: 'Running in browser-local pilot demo mode (server API unreachable).',
      },
    ],
  };
}

function loadState(): LocalState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalState;
      if (Array.isArray(parsed.issues) && Array.isArray(parsed.devices)) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  const fresh = makeInitialState();
  saveState(fresh);
  return fresh;
}

function saveState(st: LocalState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {
    // ignore quota errors
  }
}

function loadAuth(): LocalAuthDb {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalAuthDb;
      if (Array.isArray(parsed.users)) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  const seeded: LocalAuthDb = {
    users: [
      {
        id: 'USR-ADMIN-01',
        name: 'Pilot Authority Officer',
        email: 'officer@pothsheba.local',
        password: 'officer123',
        role: 'admin',
      },
      {
        id: 'USR-CIT-01',
        name: 'Pilot Citizen',
        email: 'citizen@pothsheba.local',
        password: 'citizen123',
        role: 'user',
      },
    ],
    sessions: {},
    ownership: {
      'USR-CIT-01': ['PS-001', 'PS-005'],
    },
  };
  saveAuth(seeded);
  return seeded;
}

function saveAuth(db: LocalAuthDb): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

function toAppStateResponse(st: LocalState): AppStateResponse {
  const timestamps = st.issues
    .map((i) => new Date(i.createdAt).getTime())
    .filter((n) => !Number.isNaN(n));
  const minTs = timestamps.length ? Math.min(...timestamps) : Date.now();
  const maxTs = timestamps.length ? Math.max(...timestamps) : Date.now();

  return {
    issues: st.issues,
    devices: st.devices,
    weights: st.weights,
    evaluationRuns: st.evaluationRuns,
    eventLog: st.eventLog,
    dataTimeRange: {
      start: new Date(minTs).toISOString(),
      end: new Date(maxTs).toISOString(),
    },
    integrationReadiness: {
      frontendMap: {
        status: 'Active (OpenStreetMap + Leaflet)',
        detail: 'Interactive OSM tile layer with offline corridor fallback.',
      },
      serverApi: {
        status: 'Browser Fallback Mode (Server Offline / Static Preview)',
        detail:
          'Running client-side simulation engine via localStorage because /api/* is unavailable in this environment.',
      },
      database: {
        status: 'Browser LocalStorage (PostgreSQL/PostGIS Pending)',
        detail: 'Using browser storage fallback; connect PostgreSQL + PostGIS via DATABASE_URL.',
      },
      mqttBroker: {
        status: 'Simulated Bridge (Mosquitto Pending)',
        detail: 'Device telemetry & offline queue simulated locally.',
      },
      aiPipeline: {
        status: 'Simulated Inference (YOLO + MPU6050 Pending)',
        detail: 'Simulated YOLO + vibration analyzer running locally.',
      },
    },
    pilotMeta: {
      areaName:
        'Dhaka Pilot Corridor (Campus Main Rd, Ashulia Link Rd, Birulia Market Rd, Khagan Bazar Rd)',
      center: PILOT_CENTER,
      landmarks: PILOT_LANDMARKS,
      roads: PILOT_ROADS,
    },
  };
}

export const localFallback = {
  getState(): AppStateResponse {
    return toAppStateResponse(loadState());
  },

  registerCitizen(
    name: string,
    emailRaw: string,
    password: string
  ): AuthSessionResponse {
    const db = loadAuth();
    const email = emailRaw.trim().toLowerCase();
    const cleanName = name.trim();
    if (cleanName.length < 2) throw new Error('Please enter your full name (2+ characters).');
    if (!email.includes('@')) throw new Error('Please enter a valid email address.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (db.users.some((u) => u.email === email)) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }
    const newUser: LocalUser = {
      id: `USR-${Date.now().toString(36).toUpperCase()}`,
      name: cleanName,
      email,
      password,
      role: 'user',
    };
    db.users.push(newUser);
    const token = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    db.sessions[token] = newUser.id;
    saveAuth(db);
    return {
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role },
    };
  },

  loginWithRole(
    emailRaw: string,
    password: string,
    expectedRole: UserRole
  ): AuthSessionResponse {
    const db = loadAuth();
    const email = emailRaw.trim().toLowerCase();
    const user = db.users.find((u) => u.email === email && u.password === password);
    if (!user) throw new Error('Invalid email or password.');
    if (user.role !== expectedRole) {
      throw new Error(
        expectedRole === 'admin'
          ? 'This account is a citizen account. Please sign in on the User Login page.'
          : 'This account is an authority officer account. Please use the Admin Login page.'
      );
    }
    const token = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    db.sessions[token] = user.id;
    saveAuth(db);
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  },

  getMe(token: string | null): { user: AuthUser; myReportIds: string[] } | null {
    if (!token) return null;
    const db = loadAuth();
    const userId = db.sessions[token];
    if (!userId) return null;
    const user = db.users.find((u) => u.id === userId);
    if (!user) return null;
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      myReportIds: db.ownership[user.id] ?? [],
    };
  },

  logout(token: string | null): void {
    if (!token) return;
    const db = loadAuth();
    delete db.sessions[token];
    saveAuth(db);
  },

  submitReport(
    payload: {
      type: IssueType;
      lat: number;
      lng: number;
      sizeScore: number;
      note: string;
      photoDataUrl?: string;
      privacyBlurApplied: boolean;
      privacyBlurMethod: PrivacyBlurMethod;
    },
    token: string | null
  ): { issue: RoadIssue; merged: boolean; newlyConfirmed: boolean } {
    const st = loadState();
    const me = this.getMe(token);
    const result = mergeOrCreateIssue(
      st.issues,
      {
        type: payload.type,
        lat: payload.lat,
        lng: payload.lng,
        sizeScore: payload.sizeScore,
        source: 'Citizen report',
        reporterLabel: 'Citizen (Identity Redacted)',
        detectionMethod: 'Citizen Submission',
        note: payload.note,
        photoDataUrl: payload.photoDataUrl,
        privacyBlurApplied: payload.privacyBlurApplied,
        privacyBlurMethod: payload.privacyBlurMethod,
        isSimulated: false,
      },
      PILOT_ROADS,
      PILOT_LANDMARKS,
      st.weights,
      st.nextIssueNum
    );
    st.nextIssueNum = result.nextIdNumber;
    st.eventLog.unshift({
      timestamp: new Date().toISOString(),
      source: 'Citizen report',
      message: result.merged
        ? `Merged report into ${result.issue.id} (${result.issue.confirmationCount} reports).`
        : `Created new report ${result.issue.id} (${result.issue.type}).`,
    });
    saveState(st);

    if (me) {
      const db = loadAuth();
      const list = db.ownership[me.user.id] ?? [];
      if (!list.includes(result.issue.id)) {
        list.unshift(result.issue.id);
        db.ownership[me.user.id] = list.slice(0, 50);
        saveAuth(db);
      }
    }

    return {
      issue: result.issue,
      merged: result.merged,
      newlyConfirmed: result.newlyConfirmed,
    };
  },

  trackStatus(refId: string) {
    const st = loadState();
    const clean = refId.trim().toUpperCase();
    const issue = st.issues.find((i) => i.id.toUpperCase() === clean);
    if (!issue) return null;
    return {
      id: issue.id,
      type: issue.type,
      status: issue.status,
      severity: issue.severity,
      priorityScore: issue.priorityScore,
      roadName: issue.roadName,
      confirmationCount: issue.confirmationCount,
      assignedWorker: issue.assignedWorker ? 'Field team assigned' : null,
      resolutionNotes: issue.resolutionNotes,
      updatedAt: issue.updatedAt,
      createdAt: issue.createdAt,
      history: issue.history,
    };
  },

  updateIssue(
    issueId: string,
    patch: {
      status?: WorkflowStatus;
      assignedWorker?: string | null;
      officerNotes?: string;
      resolutionNotes?: string;
    }
  ): void {
    const st = loadState();
    const issue = st.issues.find((i) => i.id.toUpperCase() === issueId.toUpperCase());
    if (!issue) throw new Error('Issue not found.');
    const nowIso = new Date().toISOString();

    if (patch.status && patch.status !== issue.status) {
      const prev = issue.status;
      issue.status = patch.status;
      if (!issue.sources.includes('Officer review')) issue.sources.push('Officer review');
      issue.history.push({
        timestamp: nowIso,
        actor: 'Authority Officer',
        action: `Status: ${prev} -> ${patch.status}`,
        detail: patch.resolutionNotes || patch.officerNotes || `Updated status to ${patch.status}.`,
      });
    }
    if (patch.assignedWorker !== undefined && patch.assignedWorker !== issue.assignedWorker) {
      issue.assignedWorker = patch.assignedWorker;
      if (patch.assignedWorker && (issue.status === 'Unconfirmed' || issue.status === 'Confirmed')) {
        issue.status = 'Assigned';
      }
    }
    if (typeof patch.officerNotes === 'string') issue.officerNotes = patch.officerNotes.trim();
    if (typeof patch.resolutionNotes === 'string') {
      issue.resolutionNotes = patch.resolutionNotes.trim();
    }
    issue.updatedAt = nowIso;
    saveState(st);
  },

  updateWeights(weights: PriorityWeights): void {
    const st = loadState();
    const sum = weights.size + weights.traffic + weights.risk || 1;
    st.weights = {
      size: Number((weights.size / sum).toFixed(2)),
      traffic: Number((weights.traffic / sum).toFixed(2)),
      risk: Number((weights.risk / sum).toFixed(2)),
    };
    for (const issue of st.issues) {
      const scored = computePriorityScore(issue, st.weights);
      issue.priorityScore = scored.priorityScore;
      issue.severity = scored.severity;
      issue.scoreReasons = scored.scoreReasons;
    }
    saveState(st);
  },

  toggleDevice(deviceId: string): void {
    const st = loadState();
    const dev = st.devices.find((d) => d.id.toUpperCase() === deviceId.toUpperCase());
    if (!dev) return;
    const nowIso = new Date().toISOString();
    if (dev.status === 'Offline') {
      dev.status = dev.category === 'vehicle' ? 'Simulating' : 'Online';
      dev.lastSeenAt = nowIso;
      while (dev.offlineQueue.length > 0) {
        const queued = dev.offlineQueue.shift()!;
        const merged = mergeOrCreateIssue(
          st.issues,
          {
            type: queued.type,
            lat: queued.lat,
            lng: queued.lng,
            sizeScore: queued.sizeScore,
            source: 'IoT device',
            deviceId: dev.id,
            reporterLabel: `${dev.name} (Offline Queue Flush)`,
            detectionMethod: queued.detectionMethod,
            note: queued.note,
            vibrationPeakG: queued.vibrationPeakG,
            vibrationDurationMs: queued.vibrationDurationMs,
            yoloConfidence: queued.yoloConfidence,
            forceConfirm: dev.category === 'pole',
            isSimulated: true,
          },
          PILOT_ROADS,
          PILOT_LANDMARKS,
          st.weights,
          st.nextIssueNum
        );
        st.nextIssueNum = merged.nextIdNumber;
        dev.recentEvents.unshift({
          timestamp: nowIso,
          summary: `Flushed ${queued.queueId} -> ${merged.issue.id}`,
          outcome: 'Flushed',
        });
      }
    } else {
      dev.status = 'Offline';
      dev.recentEvents.unshift({
        timestamp: nowIso,
        summary: 'Connection lost (Simulated); buffering locally.',
        outcome: 'Queued Offline',
      });
    }
    dev.recentEvents = dev.recentEvents.slice(0, 10);
    saveState(st);
  },

  simulateDeviceEvent(
    deviceId: string,
    scenario: string,
    extra?: Record<string, unknown>
  ): { issue?: RoadIssue } {
    const st = loadState();
    const dev = st.devices.find((d) => d.id.toUpperCase() === deviceId.toUpperCase());
    if (!dev) return {};
    const nowIso = new Date().toISOString();
    dev.lastSeenAt = nowIso;

    if (dev.category === 'pole') {
      const type: IssueType =
        scenario === 'bin'
          ? 'Bin full'
          : scenario === 'light'
          ? 'Street light off'
          : 'Waterlogging';
      const sizeScore = scenario === 'bin' ? 94 : scenario === 'light' ? 65 : 80;
      if (scenario === 'bin') dev.latestReadings.binFillPct = 94;
      else if (scenario === 'light') dev.latestReadings.streetLightState = 'Off';
      else dev.latestReadings.waterLevelCm = 21;

      const note = `Simulated pole event: ${type}.`;
      if (dev.status === 'Offline') {
        const queueId = `Q-${dev.id}-${Date.now().toString().slice(-4)}`;
        dev.offlineQueue.push({
          queueId,
          queuedAt: nowIso,
          deviceId: dev.id,
          type,
          lat: dev.lat,
          lng: dev.lng,
          roadName: dev.roadName,
          sizeScore,
          detectionMethod: type === 'Street light off' ? 'LDR / Power Sense' : 'HC-SR04 Ultrasonic',
          note,
        });
        dev.recentEvents.unshift({
          timestamp: nowIso,
          summary: `${type} queued offline (${queueId})`,
          outcome: 'Queued Offline',
        });
        dev.recentEvents = dev.recentEvents.slice(0, 10);
        st.eventLog.unshift({ timestamp: nowIso, source: dev.name, message: `Queued ${type} offline.` });
        saveState(st);
        return {};
      }
      const res = mergeOrCreateIssue(
        st.issues,
        {
          type,
          lat: dev.lat,
          lng: dev.lng,
          sizeScore,
          source: 'IoT device',
          deviceId: dev.id,
          reporterLabel: `${dev.name} (Simulated Telemetry)`,
          detectionMethod: type === 'Street light off' ? 'LDR / Power Sense' : 'HC-SR04 Ultrasonic',
          note,
          forceConfirm: true,
          isSimulated: true,
        },
        PILOT_ROADS,
        PILOT_LANDMARKS,
        st.weights,
        st.nextIssueNum
      );
      st.nextIssueNum = res.nextIdNumber;
      dev.recentEvents.unshift({
        timestamp: nowIso,
        summary: `${note} -> ${res.issue.id}`,
        outcome: 'Sent via MQTT (Simulated)',
      });
      dev.recentEvents = dev.recentEvents.slice(0, 10);
      st.eventLog.unshift({ timestamp: nowIso, source: dev.name, message: `${note} (${res.issue.id}).` });
      saveState(st);
      return { issue: res.issue };
    }

    const ambient: 'Clear Day' | 'Rain / Night' =
      extra?.ambientCondition === 'Rain / Night' ? 'Rain / Night' : 'Clear Day';
    dev.latestReadings.ambientCondition = ambient;
    const peakG =
      scenario === 'minor_bump'
        ? 1.22
        : scenario === 'speed_breaker'
        ? 1.98
        : scenario === 'crack'
        ? 1.72
        : 3.02;
    dev.latestReadings.vibrationPeakG = peakG;
    const durationMs = scenario === 'speed_breaker' ? 285 : 115;
    const analysis = analyzeSimulatedRoadEvent({
      peakG,
      durationMs,
      ambientCondition: ambient,
      hasPhoto: true,
      isSpeedBreakerGroundTruth: scenario === 'speed_breaker',
    });

    if (!analysis.passedQuickCheck) {
      dev.recentEvents.unshift({
        timestamp: nowIso,
        summary: analysis.explanation,
        outcome: 'Dropped (< 1.5g)',
      });
      dev.recentEvents = dev.recentEvents.slice(0, 10);
      st.eventLog.unshift({ timestamp: nowIso, source: dev.name, message: analysis.explanation });
      saveState(st);
      return {};
    }

    const targetLat = scenario === 'corroborate_ps001' ? 23.87682 : dev.lat;
    const targetLng = scenario === 'corroborate_ps001' ? 90.31912 : dev.lng;
    dev.lat = targetLat;
    dev.lng = targetLng;
    const issueType: IssueType = scenario === 'crack' ? 'Crack' : analysis.classifiedType;
    const sizeScore = issueType === 'Speed breaker' ? 30 : 78;

    if (dev.status === 'Offline') {
      const queueId = `Q-${dev.id}-${Date.now().toString().slice(-4)}`;
      dev.offlineQueue.push({
        queueId,
        queuedAt: nowIso,
        deviceId: dev.id,
        type: issueType,
        lat: targetLat,
        lng: targetLng,
        roadName: dev.roadName,
        sizeScore,
        vibrationPeakG: peakG,
        vibrationDurationMs: durationMs,
        yoloConfidence: analysis.yoloConfidence,
        detectionMethod: analysis.detectionMethod,
        note: analysis.explanation,
      });
      dev.recentEvents.unshift({
        timestamp: nowIso,
        summary: `Offline buffer (${queueId}): ${issueType} ${peakG.toFixed(2)}g`,
        outcome: 'Queued Offline',
      });
      dev.recentEvents = dev.recentEvents.slice(0, 10);
      st.eventLog.unshift({ timestamp: nowIso, source: dev.name, message: `Buffered ${issueType} offline (${queueId}).` });
      saveState(st);
      return {};
    }

    const res = mergeOrCreateIssue(
      st.issues,
      {
        type: issueType,
        lat: targetLat,
        lng: targetLng,
        sizeScore,
        source: 'IoT device',
        deviceId: dev.id,
        reporterLabel: `${dev.name} (Simulated Telemetry)`,
        detectionMethod: analysis.detectionMethod,
        note: analysis.explanation,
        vibrationPeakG: peakG,
        vibrationDurationMs: durationMs,
        yoloConfidence: analysis.yoloConfidence,
        isSimulated: true,
      },
      PILOT_ROADS,
      PILOT_LANDMARKS,
      st.weights,
      st.nextIssueNum
    );
    st.nextIssueNum = res.nextIdNumber;
    dev.recentEvents.unshift({
      timestamp: nowIso,
      summary: `${issueType} (${peakG.toFixed(2)}g) -> ${res.issue.id} (${res.issue.status})`,
      outcome: 'Sent via MQTT (Simulated)',
    });
    dev.recentEvents = dev.recentEvents.slice(0, 10);
    st.eventLog.unshift({ timestamp: nowIso, source: dev.name, message: `${analysis.explanation} Logged as ${res.issue.id}.` });
    saveState(st);
    return { issue: res.issue };
  },

  runAiInference(body: {
    peakG: number;
    durationMs: number;
    ambientCondition: 'Clear Day' | 'Rain / Night';
    hasPhoto: boolean;
  }): { simulated: boolean; note: string; analysis: SimulatedDetectionResult } {
    return {
      simulated: true,
      note: 'Simulated inference running locally in browser fallback mode.',
      analysis: analyzeSimulatedRoadEvent(body),
    };
  },

  addEvaluationRun(payload: {
    runLabel: string;
    roadSegment: string;
    manualCount: number;
    truePositives: number;
    falsePositives: number;
    avgDetectionDelaySec: number;
    speedBreakersTested: number;
    speedBreakersCorrectlyFiltered: number;
    notes: string;
  }): void {
    const st = loadState();
    st.evaluationRuns.unshift({
      id: `EVAL-${String(st.evaluationRuns.length + 1).padStart(2, '0')}`,
      runLabel: payload.runLabel,
      roadSegment: payload.roadSegment,
      date: new Date().toISOString().slice(0, 10),
      isSampleSimulated: false,
      manualCount: payload.manualCount,
      truePositives: payload.truePositives,
      falsePositives: payload.falsePositives,
      falseNegatives: Math.max(0, payload.manualCount - payload.truePositives),
      avgDetectionDelaySec: payload.avgDetectionDelaySec,
      speedBreakersTested: payload.speedBreakersTested,
      speedBreakersCorrectlyFiltered: payload.speedBreakersCorrectlyFiltered,
      notes: payload.notes,
    });
    saveState(st);
  },

  resetDemo(): AppStateResponse {
    const fresh = makeInitialState();
    saveState(fresh);
    return toAppStateResponse(fresh);
  },
};
