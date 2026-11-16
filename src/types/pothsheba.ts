export type IssueType =
  | 'Pothole'
  | 'Crack'
  | 'Speed breaker'
  | 'Waterlogging'
  | 'Bin full'
  | 'Street light off';

export type WorkflowStatus =
  | 'Unconfirmed'
  | 'Confirmed'
  | 'Assigned'
  | 'In Progress'
  | 'Resolved';

export type IssueSource =
  | 'IoT device'
  | 'AI analysis'
  | 'Citizen report'
  | 'Officer review';

export type SeverityLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export type DetectionMethod =
  | 'YOLO Photo (Simulated)'
  | 'MPU6050 Vibration'
  | 'Photo + Vibration'
  | 'HC-SR04 Ultrasonic'
  | 'LDR / Power Sense'
  | 'Citizen Submission'
  | 'Officer Inspection';

export type PrivacyBlurMethod =
  | 'Manual Canvas Blur'
  | 'Simulated Auto-Blur Preview'
  | 'None';

export interface EvidenceReport {
  id: string;
  timestamp: string;
  source: IssueSource;
  deviceId?: string;
  reporterLabel: string; // Never contains personal PII on public views
  detectionMethod: DetectionMethod;
  note: string;
  photoDataUrl?: string;
  privacyBlurApplied: boolean;
  privacyBlurMethod: PrivacyBlurMethod;
  vibrationPeakG?: number;
  vibrationDurationMs?: number;
  yoloConfidence?: number;
}

export interface IssueHistoryEntry {
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface RoadIssue {
  id: string;
  type: IssueType;
  status: WorkflowStatus;
  severity: SeverityLevel;
  priorityScore: number;
  lat: number;
  lng: number;
  roadName: string;
  nearestLandmark: string;
  distanceToLandmarkM: number;
  sizeScore: number;
  trafficScore: number;
  riskScore: number;
  scoreReasons: string[];
  confirmationCount: number;
  sources: IssueSource[];
  detectionMethods: DetectionMethod[];
  isSimulated: boolean;
  aiSummary: string; // Clearly distinguished from officer-confirmed notes
  aiConfidence?: number;
  vibrationPeakG?: number;
  vibrationDurationMs?: number;
  evidenceReports: EvidenceReport[];
  assignedWorker: string | null;
  officerNotes: string;
  resolutionNotes: string;
  history: IssueHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface OfflineQueuedEvent {
  queueId: string;
  queuedAt: string;
  deviceId: string;
  type: IssueType;
  lat: number;
  lng: number;
  roadName: string;
  sizeScore: number;
  vibrationPeakG?: number;
  vibrationDurationMs?: number;
  yoloConfidence?: number;
  detectionMethod: DetectionMethod;
  note: string;
}

export interface SensorDevice {
  id: string;
  name: string;
  category: 'vehicle' | 'pole';
  mountLabel: string;
  hardwareStack: string[];
  connectivity: 'Wi-Fi' | 'Mobile Data' | 'Wi-Fi / Mobile Data';
  protocols: string;
  mqttTopic: string;
  status: 'Online' | 'Offline' | 'Simulating';
  lastSeenAt: string;
  lat: number;
  lng: number;
  roadName: string;
  batteryPct: number;
  latestReadings: {
    vibrationPeakG?: number;
    speedKmh?: number;
    gpsSatellites?: number;
    gpsAccuracyM?: number;
    waterLevelCm?: number;
    binFillPct?: number;
    streetLightState?: 'On' | 'Off';
    ambientCondition?: 'Clear Day' | 'Rain / Night';
  };
  offlineQueue: OfflineQueuedEvent[];
  recentEvents: {
    timestamp: string;
    summary: string;
    outcome: 'Sent via MQTT (Simulated)' | 'Dropped (< 1.5g)' | 'Queued Offline' | 'Flushed';
  }[];
}

export interface PriorityWeights {
  size: number;
  traffic: number;
  risk: number;
}

export interface EvaluationRun {
  id: string;
  runLabel: string;
  roadSegment: string;
  date: string;
  isSampleSimulated: boolean;
  manualCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  avgDetectionDelaySec: number;
  speedBreakersTested: number;
  speedBreakersCorrectlyFiltered: number;
  notes: string;
}

export interface PilotLandmark {
  id: string;
  name: string;
  kind: 'School' | 'Hospital' | 'Bus stop';
  lat: number;
  lng: number;
}

export interface PilotRoadCorridor {
  id: string;
  name: string;
  trafficScore: number;
  trafficLabel: string;
  coordinates: [number, number][];
}

export interface IntegrationReadiness {
  frontendMap: { status: string; detail: string };
  serverApi: { status: string; detail: string };
  database: { status: string; detail: string };
  mqttBroker: { status: string; detail: string };
  aiPipeline: { status: string; detail: string };
}

export interface AppStateResponse {
  issues: RoadIssue[];
  devices: SensorDevice[];
  weights: PriorityWeights;
  evaluationRuns: EvaluationRun[];
  eventLog: { timestamp: string; source: string; message: string }[];
  dataTimeRange: { start: string; end: string };
  integrationReadiness: IntegrationReadiness;
  pilotMeta: {
    areaName: string;
    center: [number, number];
    landmarks: PilotLandmark[];
    roads: PilotRoadCorridor[];
  };
}

export const ISSUE_TYPES: IssueType[] = [
  'Pothole',
  'Crack',
  'Speed breaker',
  'Waterlogging',
  'Bin full',
  'Street light off',
];

export const WORKFLOW_STATUSES: WorkflowStatus[] = [
  'Unconfirmed',
  'Confirmed',
  'Assigned',
  'In Progress',
  'Resolved',
];

export const SEVERITY_LEVELS: SeverityLevel[] = [
  'Critical',
  'High',
  'Medium',
  'Low',
];

export const ISSUE_SOURCES: IssueSource[] = [
  'IoT device',
  'AI analysis',
  'Citizen report',
  'Officer review',
];

export const FIELD_WORKERS = [
  'Tariqul Hasan (Road Crew A)',
  'Nusrat Jahan (Drainage & Public Space)',
  'Kamrul Islam (Electrical & Lighting)',
  'Sajib Mia (Rapid Patch Unit)',
];

export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthSessionResponse {
  token: string;
  user: AuthUser;
}

