import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AppStateResponse,
  EvaluationRun,
  IssueType,
  PriorityWeights,
  RoadIssue,
  SensorDevice,
  WorkflowStatus,
} from './src/types/pothsheba.ts';
import {
  analyzeSimulatedRoadEvent,
  computePriorityScore,
  DEFAULT_PRIORITY_WEIGHTS,
  mergeOrCreateIssue,
} from './src/services/pothshebaEngine.ts';
import {
  createSeedDevices,
  createSeedEvaluationRuns,
  createSeedIssues,
  PILOT_CENTER,
  PILOT_LANDMARKS,
  PILOT_ROADS,
} from './src/data/pilotSeed.ts';
import { AuthStore } from './src/services/authStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'pothsheba-state.json');
const authStore = new AuthStore(DATA_DIR);

interface PersistedState {
  nextIssueNum: number;
  issues: RoadIssue[];
  devices: SensorDevice[];
  weights: PriorityWeights;
  evaluationRuns: EvaluationRun[];
  eventLog: { timestamp: string; source: string; message: string }[];
}

function createInitialState(): PersistedState {
  const now = new Date().toISOString();
  return {
    nextIssueNum: 8,
    issues: createSeedIssues(),
    devices: createSeedDevices(),
    weights: { ...DEFAULT_PRIORITY_WEIGHTS },
    evaluationRuns: createSeedEvaluationRuns(),
    eventLog: [
      {
        timestamp: now,
        source: 'System',
        message:
          'PothSheba pilot prototype initialized with Dhaka campus corridor sample data (Demo Mode).',
      },
    ],
  };
}

function loadState(): PersistedState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.issues) && Array.isArray(parsed.devices)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not read persisted state file, using initial pilot seed:', err);
  }
  const initial = createInitialState();
  saveState(initial);
  return initial;
}

function saveState(state: PersistedState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Skipping disk write for state:', err);
  }
}

let state: PersistedState = loadState();

function appendLog(source: string, message: string): void {
  state.eventLog.unshift({
    timestamp: new Date().toISOString(),
    source,
    message,
  });
  if (state.eventLog.length > 80) {
    state.eventLog.length = 80;
  }
}

function recalculateAllScores(): void {
  for (const issue of state.issues) {
    const scored = computePriorityScore(issue, state.weights);
    issue.priorityScore = scored.priorityScore;
    issue.severity = scored.severity;
    issue.scoreReasons = scored.scoreReasons;
  }
}

function buildPublicState(): AppStateResponse {
  const timestamps = state.issues
    .map((i) => new Date(i.createdAt).getTime())
    .filter((n) => !Number.isNaN(n));
  const minTs = timestamps.length ? Math.min(...timestamps) : Date.now();
  const maxTs = timestamps.length ? Math.max(...timestamps) : Date.now();

  return {
    issues: state.issues,
    devices: state.devices,
    weights: state.weights,
    evaluationRuns: state.evaluationRuns,
    eventLog: state.eventLog,
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
        status: 'Active (Express REST API)',
        detail: 'Serving /api/* routes on port 3000.',
      },
      database: {
        status: 'Local JSON Store (PostgreSQL/PostGIS Pending)',
        detail:
          'Using local JSON persistence for pilot demo; ready to swap for PostgreSQL + PostGIS via DATABASE_URL.',
      },
      mqttBroker: {
        status: 'Simulated Bridge (Mosquitto Pending)',
        detail:
          'Device telemetry & offline queue simulated; future Mosquitto broker connects via MQTT_BROKER_URL -> /api/telemetry/mqtt-ingest.',
      },
      aiPipeline: {
        status: 'Simulated Inference (YOLO + MPU6050 Pending)',
        detail:
          'YOLO-style photo & vibration classification simulated in prototype; connect FastAPI model server via AI_SERVICE_URL -> /api/integrations/ai-inference.',
      },
    },
    pilotMeta: {
      areaName: 'Dhaka Pilot Corridor (Campus Main Rd, Ashulia Link Rd, Birulia Market Rd, Khagan Bazar Rd)',
      center: PILOT_CENTER,
      landmarks: PILOT_LANDMARKS,
      roads: PILOT_ROADS,
    },
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const extractBearer = (req: express.Request): string | undefined => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return undefined;
    return auth.slice(7).trim();
  };

  const requireAdmin: express.RequestHandler = (req, res, next) => {
    const user = authStore.getUserByToken(extractBearer(req));
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }
    if (user.role !== 'admin') {
      res.status(403).json({ error: 'Authority officer access required.' });
      return;
    }
    next();
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: 'pilot-demo',
      integrations: buildPublicState().integrationReadiness,
    });
  });

  // Authentication endpoints (Citizen Sign Up / User Login / Admin Login)
  app.post('/api/auth/register', (req, res) => {
    const body = req.body ?? {};
    const result = authStore.registerCitizen(
      String(body.name ?? ''),
      String(body.email ?? ''),
      String(body.password ?? '')
    );
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(result.session);
  });

  app.post('/api/auth/login-user', (req, res) => {
    const body = req.body ?? {};
    const result = authStore.loginWithRole(
      String(body.email ?? ''),
      String(body.password ?? ''),
      'user'
    );
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json(result.session);
  });

  app.post('/api/auth/login-admin', (req, res) => {
    const body = req.body ?? {};
    const result = authStore.loginWithRole(
      String(body.email ?? ''),
      String(body.password ?? ''),
      'admin'
    );
    if (!result.ok) {
      res.status(401).json({ error: result.error });
      return;
    }
    res.json(result.session);
  });

  app.get('/api/auth/me', (req, res) => {
    const user = authStore.getUserByToken(extractBearer(req));
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    res.json({
      user,
      myReportIds: authStore.getOwnedReportIds(user.id),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    authStore.logout(extractBearer(req));
    res.json({ ok: true });
  });

  app.get('/api/my-reports', (req, res) => {
    const user = authStore.getUserByToken(extractBearer(req));
    if (!user) {
      res.status(401).json({ error: 'Sign in to view your submitted reports.' });
      return;
    }
    const ownedIds = authStore.getOwnedReportIds(user.id);
    const issues = state.issues
      .filter((i) => ownedIds.includes(i.id))
      .map((i) => ({
        id: i.id,
        type: i.type,
        status: i.status,
        severity: i.severity,
        priorityScore: i.priorityScore,
        roadName: i.roadName,
        confirmationCount: i.confirmationCount,
        resolutionNotes: i.resolutionNotes,
        updatedAt: i.updatedAt,
        createdAt: i.createdAt,
      }));
    res.json({ issues });
  });

  app.get('/api/state', (_req, res) => {
    res.json(buildPublicState());
  });

  // Citizen or Officer report submission (never stores/exposes personal PII)
  app.post('/api/reports', (req, res) => {
    const body = req.body ?? {};
    const type = body.type as IssueType;
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const sizeScore = Number(body.sizeScore ?? 60);

    if (!type || Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Issue type, latitude, and longitude are required.' });
      return;
    }

    const authUser = authStore.getUserByToken(extractBearer(req));
    const source =
      body.source === 'Officer review' && authUser?.role === 'admin'
        ? 'Officer review'
        : 'Citizen report';
    const result = mergeOrCreateIssue(
      state.issues,
      {
        type,
        lat,
        lng,
        sizeScore,
        source,
        reporterLabel:
          source === 'Officer review' ? 'Pilot Officer' : 'Citizen (Identity Redacted)',
        detectionMethod:
          source === 'Officer review' ? 'Officer Inspection' : 'Citizen Submission',
        note: String(body.note ?? '').slice(0, 500),
        photoDataUrl: typeof body.photoDataUrl === 'string' ? body.photoDataUrl : undefined,
        privacyBlurApplied: Boolean(body.privacyBlurApplied),
        privacyBlurMethod: body.privacyBlurMethod ?? 'None',
        forceConfirm: source === 'Officer review',
        isSimulated: false,
      },
      PILOT_ROADS,
      PILOT_LANDMARKS,
      state.weights,
      state.nextIssueNum
    );

    if (authUser) {
      authStore.linkReport(authUser.id, result.issue.id);
    }

    state.nextIssueNum = result.nextIdNumber;
    appendLog(
      source,
      result.merged
        ? `Report merged into ${result.issue.id} (${result.issue.confirmationCount} supporting reports, status: ${result.issue.status}).`
        : `New report ${result.issue.id} created (${result.issue.type} on ${result.issue.roadName}, status: ${result.issue.status}).`
    );
    saveState(state);
    res.status(201).json({
      issue: result.issue,
      merged: result.merged,
      newlyConfirmed: result.newlyConfirmed,
    });
  });

  // Public report status tracker (strips any internal officer-only notes if needed, keeps PII absent)
  app.get('/api/reports/:id/status', (req, res) => {
    const refId = String(req.params.id ?? '').trim().toUpperCase();
    const issue = state.issues.find((i) => i.id.toUpperCase() === refId);
    if (!issue) {
      res.status(404).json({ error: `No report found with reference ID ${refId}.` });
      return;
    }

    res.json({
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
    });
  });

  // Officer workflow review, assignment, and resolution
  app.patch('/api/issues/:id', requireAdmin, (req, res) => {
    const issueId = String(req.params.id ?? '').toUpperCase();
    const issue = state.issues.find((i) => i.id.toUpperCase() === issueId);
    if (!issue) {
      res.status(404).json({ error: `Issue ${issueId} not found.` });
      return;
    }

    const body = req.body ?? {};
    const nowIso = new Date().toISOString();
    const validStatuses: WorkflowStatus[] = [
      'Unconfirmed',
      'Confirmed',
      'Assigned',
      'In Progress',
      'Resolved',
    ];

    if (body.status && validStatuses.includes(body.status) && body.status !== issue.status) {
      const prevStatus = issue.status;
      issue.status = body.status;
      if (!issue.sources.includes('Officer review')) {
        issue.sources.push('Officer review');
      }
      issue.history.push({
        timestamp: nowIso,
        actor: 'Authority Officer',
        action: `Status: ${prevStatus} -> ${body.status}`,
        detail:
          typeof body.resolutionNotes === 'string' && body.resolutionNotes.trim()
            ? body.resolutionNotes.trim()
            : typeof body.officerNotes === 'string' && body.officerNotes.trim()
            ? body.officerNotes.trim()
            : `Updated workflow status to ${body.status}.`,
      });
      appendLog('Officer', `${issue.id} moved from ${prevStatus} to ${body.status}.`);
    }

    if (typeof body.assignedWorker === 'string' || body.assignedWorker === null) {
      if (body.assignedWorker !== issue.assignedWorker) {
        issue.assignedWorker = body.assignedWorker;
        if (body.assignedWorker) {
          if (issue.status === 'Unconfirmed' || issue.status === 'Confirmed') {
            issue.status = 'Assigned';
          }
          issue.history.push({
            timestamp: nowIso,
            actor: 'Authority Officer',
            action: 'Worker Assigned',
            detail: `Assigned to ${body.assignedWorker}.`,
          });
          appendLog('Officer', `${issue.id} assigned to ${body.assignedWorker}.`);
        }
      }
    }

    if (typeof body.officerNotes === 'string') {
      issue.officerNotes = body.officerNotes.trim();
    }
    if (typeof body.resolutionNotes === 'string') {
      issue.resolutionNotes = body.resolutionNotes.trim();
    }

    issue.updatedAt = nowIso;
    saveState(state);
    res.json({ issue });
  });

  // Toggle IoT device Online/Offline and flush offline queue on reconnect
  app.post('/api/devices/:id/toggle-connection', requireAdmin, (req, res) => {
    const devId = String(req.params.id ?? '').toUpperCase();
    const device = state.devices.find((d) => d.id.toUpperCase() === devId);
    if (!device) {
      res.status(404).json({ error: `Device ${devId} not found.` });
      return;
    }

    const nowIso = new Date().toISOString();
    if (device.status === 'Offline') {
      device.status = device.category === 'vehicle' ? 'Simulating' : 'Online';
      device.lastSeenAt = nowIso;

      const flushedResults: { issueId: string; merged: boolean; status: WorkflowStatus }[] = [];
      while (device.offlineQueue.length > 0) {
        const queued = device.offlineQueue.shift()!;
        const merged = mergeOrCreateIssue(
          state.issues,
          {
            type: queued.type,
            lat: queued.lat,
            lng: queued.lng,
            sizeScore: queued.sizeScore,
            source: 'IoT device',
            deviceId: device.id,
            reporterLabel: `${device.name} (Offline Queue Flush)`,
            detectionMethod: queued.detectionMethod,
            note: queued.note,
            vibrationPeakG: queued.vibrationPeakG,
            vibrationDurationMs: queued.vibrationDurationMs,
            yoloConfidence: queued.yoloConfidence,
            forceConfirm: device.category === 'pole',
            isSimulated: true,
          },
          PILOT_ROADS,
          PILOT_LANDMARKS,
          state.weights,
          state.nextIssueNum
        );
        state.nextIssueNum = merged.nextIdNumber;
        flushedResults.push({
          issueId: merged.issue.id,
          merged: merged.merged,
          status: merged.issue.status,
        });
        device.recentEvents.unshift({
          timestamp: nowIso,
          summary: `Flushed ${queued.queueId} -> ${merged.issue.id} (${merged.merged ? 'Merged' : 'New'})`,
          outcome: 'Flushed',
        });
      }

      if (flushedResults.length > 0) {
        appendLog(
          device.name,
          `Reconnected and flushed ${flushedResults.length} offline queued event(s) via simulated MQTT.`
        );
      } else {
        appendLog(device.name, `Reconnected (${device.status}). No queued offline events.`);
      }
      device.recentEvents = device.recentEvents.slice(0, 10);
      saveState(state);
      res.json({ device, flushed: flushedResults });
      return;
    }

    device.status = 'Offline';
    device.recentEvents.unshift({
      timestamp: nowIso,
      summary: 'Connection lost (Simulated); subsequent events will buffer in offline queue.',
      outcome: 'Queued Offline',
    });
    device.recentEvents = device.recentEvents.slice(0, 10);
    appendLog(device.name, 'Connection switched to Offline (local buffering active).');
    saveState(state);
    res.json({ device, flushed: [] });
  });

  // Simulate an IoT sensor event (vehicle road shock or fixed pole telemetry)
  app.post('/api/devices/:id/simulate-event', requireAdmin, (req, res) => {
    const devId = String(req.params.id ?? '').toUpperCase();
    const device = state.devices.find((d) => d.id.toUpperCase() === devId);
    if (!device) {
      res.status(404).json({ error: `Device ${devId} not found.` });
      return;
    }

    const body = req.body ?? {};
    const scenario = String(body.scenario ?? 'pothole');
    const nowIso = new Date().toISOString();
    device.lastSeenAt = nowIso;

    if (device.category === 'pole') {
      let type: IssueType = 'Waterlogging';
      let sizeScore = 76;
      let note = '';

      if (scenario === 'waterlogging') {
        const level = Number(body.waterLevelCm ?? 21);
        device.latestReadings.waterLevelCm = level;
        type = 'Waterlogging';
        sizeScore = Math.min(100, Math.round(level * 3.8));
        note = `Simulated HC-SR04 reading: ${level} cm standing water (> 15 cm threshold).`;
      } else if (scenario === 'bin') {
        const fill = Number(body.binFillPct ?? 94);
        device.latestReadings.binFillPct = fill;
        type = 'Bin full';
        sizeScore = fill;
        note = `Simulated HC-SR04 reading: bin fill at ${fill}% (> 85% threshold).`;
      } else {
        device.latestReadings.streetLightState = 'Off';
        type = 'Street light off';
        sizeScore = 65;
        note = 'Simulated pole light sensor: street light off after dusk.';
      }

      if (device.status === 'Offline') {
        const queueId = `Q-${device.id}-${Date.now().toString().slice(-4)}`;
        device.offlineQueue.push({
          queueId,
          queuedAt: nowIso,
          deviceId: device.id,
          type,
          lat: device.lat,
          lng: device.lng,
          roadName: device.roadName,
          sizeScore,
          detectionMethod: type === 'Street light off' ? 'LDR / Power Sense' : 'HC-SR04 Ultrasonic',
          note,
        });
        device.recentEvents.unshift({
          timestamp: nowIso,
          summary: `${type} queued offline (${queueId})`,
          outcome: 'Queued Offline',
        });
        device.recentEvents = device.recentEvents.slice(0, 10);
        appendLog(device.name, `Offline queue buffered ${type} alert (${queueId}).`);
        saveState(state);
        res.json({ queued: true, device });
        return;
      }

      const result = mergeOrCreateIssue(
        state.issues,
        {
          type,
          lat: device.lat,
          lng: device.lng,
          sizeScore,
          source: 'IoT device',
          deviceId: device.id,
          reporterLabel: `${device.name} (Simulated Telemetry)`,
          detectionMethod: type === 'Street light off' ? 'LDR / Power Sense' : 'HC-SR04 Ultrasonic',
          note,
          forceConfirm: true,
          isSimulated: true,
        },
        PILOT_ROADS,
        PILOT_LANDMARKS,
        state.weights,
        state.nextIssueNum
      );
      state.nextIssueNum = result.nextIdNumber;
      device.recentEvents.unshift({
        timestamp: nowIso,
        summary: `${note} -> ${result.issue.id}`,
        outcome: 'Sent via MQTT (Simulated)',
      });
      device.recentEvents = device.recentEvents.slice(0, 10);
      appendLog(device.name, `${note} (${result.issue.id}).`);
      saveState(state);
      res.json({ queued: false, device, issue: result.issue, merged: result.merged });
      return;
    }

    // Vehicle device simulation
    const ambient: 'Clear Day' | 'Rain / Night' =
      body.ambientCondition === 'Rain / Night' ? 'Rain / Night' : 'Clear Day';
    device.latestReadings.ambientCondition = ambient;

    let peakG = 2.95;
    let durationMs = 115;
    let isBreaker = false;

    if (scenario === 'minor_bump') {
      peakG = 1.22;
      durationMs = 75;
    } else if (scenario === 'speed_breaker') {
      peakG = 1.98;
      durationMs = 285;
      isBreaker = true;
    } else if (scenario === 'crack') {
      peakG = 1.72;
      durationMs = 95;
    } else if (scenario === 'corroborate_ps001') {
      peakG = 3.05;
      durationMs = 118;
    }

    device.latestReadings.vibrationPeakG = peakG;

    const analysis = analyzeSimulatedRoadEvent({
      peakG,
      durationMs,
      ambientCondition: ambient,
      hasPhoto: true,
      isSpeedBreakerGroundTruth: isBreaker,
    });

    if (!analysis.passedQuickCheck) {
      device.recentEvents.unshift({
        timestamp: nowIso,
        summary: analysis.explanation,
        outcome: 'Dropped (< 1.5g)',
      });
      device.recentEvents = device.recentEvents.slice(0, 10);
      appendLog(device.name, analysis.explanation);
      saveState(state);
      res.json({ dropped: true, analysis, device });
      return;
    }

    const targetLat =
      scenario === 'corroborate_ps001'
        ? 23.87682
        : Number((device.lat + (Math.random() - 0.5) * 0.0004).toFixed(6));
    const targetLng =
      scenario === 'corroborate_ps001'
        ? 90.31912
        : Number((device.lng + (Math.random() - 0.5) * 0.0004).toFixed(6));
    device.lat = targetLat;
    device.lng = targetLng;

    const issueType: IssueType =
      scenario === 'crack' ? 'Crack' : analysis.classifiedType;
    const sizeScore =
      issueType === 'Speed breaker'
        ? 30
        : issueType === 'Crack'
        ? 54
        : Math.min(96, Math.round((peakG - 1.1) * 34));

    if (device.status === 'Offline') {
      const queueId = `Q-${device.id}-${Date.now().toString().slice(-4)}`;
      device.offlineQueue.push({
        queueId,
        queuedAt: nowIso,
        deviceId: device.id,
        type: issueType,
        lat: targetLat,
        lng: targetLng,
        roadName: device.roadName,
        sizeScore,
        vibrationPeakG: peakG,
        vibrationDurationMs: durationMs,
        yoloConfidence: analysis.yoloConfidence,
        detectionMethod: analysis.detectionMethod,
        note: analysis.explanation,
      });
      device.recentEvents.unshift({
        timestamp: nowIso,
        summary: `Offline buffer (${queueId}): ${issueType} ${peakG.toFixed(2)}g`,
        outcome: 'Queued Offline',
      });
      device.recentEvents = device.recentEvents.slice(0, 10);
      appendLog(device.name, `Device offline — buffered ${issueType} event in ${queueId}.`);
      saveState(state);
      res.json({ queued: true, analysis, device });
      return;
    }

    const result = mergeOrCreateIssue(
      state.issues,
      {
        type: issueType,
        lat: targetLat,
        lng: targetLng,
        sizeScore,
        source: 'IoT device',
        deviceId: device.id,
        reporterLabel: `${device.name} (Simulated Telemetry)`,
        detectionMethod: analysis.detectionMethod,
        note: analysis.explanation,
        vibrationPeakG: peakG,
        vibrationDurationMs: durationMs,
        yoloConfidence: analysis.yoloConfidence,
        isSimulated: true,
      },
      PILOT_ROADS,
      PILOT_LANDMARKS,
      state.weights,
      state.nextIssueNum
    );
    state.nextIssueNum = result.nextIdNumber;

    device.recentEvents.unshift({
      timestamp: nowIso,
      summary: `${issueType} (${peakG.toFixed(2)}g) -> ${result.issue.id} (${result.issue.status})`,
      outcome: 'Sent via MQTT (Simulated)',
    });
    device.recentEvents = device.recentEvents.slice(0, 10);
    appendLog(device.name, `${analysis.explanation} Logged as ${result.issue.id}.`);
    saveState(state);

    res.json({
      queued: false,
      analysis,
      device,
      issue: result.issue,
      merged: result.merged,
      newlyConfirmed: result.newlyConfirmed,
    });
  });

  // Clean integration point for future MQTT broker bridge (e.g., Mosquitto webhook/worker)
  app.post('/api/telemetry/mqtt-ingest', (req, res) => {
    const body = req.body ?? {};
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const type = (body.type as IssueType) || 'Pothole';

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      res.status(400).json({ error: 'Valid lat and lng coordinates are required.' });
      return;
    }

    const result = mergeOrCreateIssue(
      state.issues,
      {
        type,
        lat,
        lng,
        sizeScore: Number(body.sizeScore ?? 65),
        source: 'IoT device',
        deviceId: String(body.deviceId ?? 'MQTT-BRIDGE'),
        reporterLabel: String(body.deviceId ?? 'MQTT Telemetry'),
        detectionMethod: 'Photo + Vibration',
        note: String(body.note ?? 'Ingested via /api/telemetry/mqtt-ingest integration endpoint.'),
        vibrationPeakG: body.vibrationPeakG != null ? Number(body.vibrationPeakG) : undefined,
        vibrationDurationMs:
          body.vibrationDurationMs != null ? Number(body.vibrationDurationMs) : undefined,
        yoloConfidence: body.yoloConfidence != null ? Number(body.yoloConfidence) : undefined,
        isSimulated: Boolean(body.isSimulated ?? true),
      },
      PILOT_ROADS,
      PILOT_LANDMARKS,
      state.weights,
      state.nextIssueNum
    );
    state.nextIssueNum = result.nextIdNumber;
    appendLog('MQTT Bridge', `Ingested payload for ${result.issue.id} (${result.issue.type}).`);
    saveState(state);
    res.status(201).json({ accepted: true, ...result });
  });

  // Clean integration point for future YOLO + Vibration classifier microservice
  app.post('/api/integrations/ai-inference', (req, res) => {
    const body = req.body ?? {};
    const analysis = analyzeSimulatedRoadEvent({
      peakG: Number(body.peakG ?? 2.4),
      durationMs: Number(body.durationMs ?? 120),
      ambientCondition:
        body.ambientCondition === 'Rain / Night' ? 'Rain / Night' : 'Clear Day',
      hasPhoto: body.hasPhoto !== false,
      isSpeedBreakerGroundTruth: Boolean(body.isSpeedBreakerGroundTruth),
    });

    res.json({
      simulated: true,
      note: 'Simulated inference only. Connect a trained YOLOv8 + vibration model server via AI_SERVICE_URL for live inference.',
      analysis,
    });
  });

  // Configurable Priority Weights (proposal formula: 0.4 * Size + 0.3 * Traffic + 0.3 * Risk)
  app.put('/api/config/priority-weights', requireAdmin, (req, res) => {
    const body = req.body ?? {};
    const size = Math.max(0, Number(body.size ?? 0.4));
    const traffic = Math.max(0, Number(body.traffic ?? 0.3));
    const risk = Math.max(0, Number(body.risk ?? 0.3));
    const sum = size + traffic + risk;

    if (sum <= 0) {
      res.status(400).json({ error: 'At least one weight must be greater than 0.' });
      return;
    }

    state.weights = {
      size: Number((size / sum).toFixed(2)),
      traffic: Number((traffic / sum).toFixed(2)),
      risk: Number((risk / sum).toFixed(2)),
    };
    recalculateAllScores();
    appendLog(
      'Config',
      `Priority weights updated to Size ${state.weights.size}, Traffic ${state.weights.traffic}, Risk ${state.weights.risk}.`
    );
    saveState(state);
    res.json({ weights: state.weights, issues: state.issues });
  });

  // Record pilot road testing evaluation run vs manual count
  app.post('/api/evaluation', requireAdmin, (req, res) => {
    const body = req.body ?? {};
    const manualCount = Math.max(1, Number(body.manualCount ?? 1));
    const truePositives = Math.max(0, Number(body.truePositives ?? 0));
    const falsePositives = Math.max(0, Number(body.falsePositives ?? 0));
    const falseNegatives = Math.max(0, manualCount - truePositives);

    const run: EvaluationRun = {
      id: `EVAL-${String(state.evaluationRuns.length + 1).padStart(2, '0')}`,
      runLabel: String(body.runLabel ?? 'Pilot Field Test Run').trim(),
      roadSegment: String(body.roadSegment ?? 'Campus Main Rd').trim(),
      date: String(body.date ?? new Date().toISOString().slice(0, 10)),
      isSampleSimulated: Boolean(body.isSampleSimulated),
      manualCount,
      truePositives,
      falsePositives,
      falseNegatives,
      avgDetectionDelaySec: Math.max(0, Number(body.avgDetectionDelaySec ?? 0)),
      speedBreakersTested: Math.max(0, Number(body.speedBreakersTested ?? 0)),
      speedBreakersCorrectlyFiltered: Math.max(
        0,
        Number(body.speedBreakersCorrectlyFiltered ?? 0)
      ),
      notes: String(body.notes ?? '').trim(),
    };

    state.evaluationRuns.unshift(run);
    appendLog('Evaluation', `Recorded ${run.id}: ${run.runLabel} (${run.roadSegment}).`);
    saveState(state);
    res.status(201).json({ run });
  });

  app.post('/api/demo/reset', requireAdmin, (_req, res) => {
    state = createInitialState();
    saveState(state);
    res.json(buildPublicState());
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT ?? 3000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PothSheba server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
