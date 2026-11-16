import type {
  AppStateResponse,
  AuthSessionResponse,
  AuthUser,
  IssueType,
  PriorityWeights,
  PrivacyBlurMethod,
  RoadIssue,
  WorkflowStatus,
} from '../types/pothsheba.ts';
import type { SimulatedDetectionResult } from './pothshebaEngine.ts';
import { localFallback } from './localApiFallback.ts';

let usingFallbackMode = false;

export function isUsingFallbackMode(): boolean {
  return usingFallbackMode;
}

async function fetchJsonWithRetry(
  url: string,
  options?: RequestInit,
  retries = 2
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        // Static hosting (e.g. Vercel or vite preview) returned HTML/404 for /api/*
        throw new Error('NON_JSON_API_RESPONSE');
      }
      return res;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message === 'NON_JSON_API_RESPONSE') {
        throw err;
      }
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  }
  throw lastError;
}

export const apiClient = {
  async getState(): Promise<AppStateResponse> {
    try {
      const res = await fetchJsonWithRetry('/api/state', undefined, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      usingFallbackMode = false;
      return (await res.json()) as AppStateResponse;
    } catch {
      usingFallbackMode = true;
      return localFallback.getState();
    }
  },

  async loginUser(email: string, password: string): Promise<AuthSessionResponse> {
    try {
      const res = await fetchJsonWithRetry(
        '/api/auth/login-user',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        },
        1
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Authentication failed.');
      usingFallbackMode = false;
      return json as AuthSessionResponse;
    } catch (err) {
      if (err instanceof Error && err.message !== 'NON_JSON_API_RESPONSE' && !err.message.includes('fetch')) {
        throw err;
      }
      usingFallbackMode = true;
      return localFallback.loginWithRole(email, password, 'user');
    }
  },

  async registerCitizen(
    name: string,
    email: string,
    password: string
  ): Promise<AuthSessionResponse> {
    try {
      const res = await fetchJsonWithRetry(
        '/api/auth/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        },
        1
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Registration failed.');
      usingFallbackMode = false;
      return json as AuthSessionResponse;
    } catch (err) {
      if (err instanceof Error && err.message !== 'NON_JSON_API_RESPONSE' && !err.message.includes('fetch')) {
        throw err;
      }
      usingFallbackMode = true;
      return localFallback.registerCitizen(name, email, password);
    }
  },

  async loginAdmin(email: string, password: string): Promise<AuthSessionResponse> {
    try {
      const res = await fetchJsonWithRetry(
        '/api/auth/login-admin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        },
        1
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Officer authentication failed.');
      usingFallbackMode = false;
      return json as AuthSessionResponse;
    } catch (err) {
      if (err instanceof Error && err.message !== 'NON_JSON_API_RESPONSE' && !err.message.includes('fetch')) {
        throw err;
      }
      usingFallbackMode = true;
      return localFallback.loginWithRole(email, password, 'admin');
    }
  },

  async getMe(token: string): Promise<{ user: AuthUser; myReportIds: string[] } | null> {
    if (token.startsWith('local-')) {
      usingFallbackMode = true;
      return localFallback.getMe(token);
    }
    try {
      const res = await fetchJsonWithRetry(
        '/api/auth/me',
        { headers: { Authorization: `Bearer ${token}` } },
        1
      );
      if (!res.ok) return null;
      return (await res.json()) as { user: AuthUser; myReportIds: string[] };
    } catch {
      return localFallback.getMe(token);
    }
  },

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    if (token.startsWith('local-')) {
      localFallback.logout(token);
      return;
    }
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignore
    }
  },

  async submitReport(
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
  ): Promise<{ issue: RoadIssue; merged: boolean; newlyConfirmed: boolean }> {
    if (usingFallbackMode) {
      return localFallback.submitReport(payload, token);
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchJsonWithRetry(
        '/api/reports',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...payload, source: 'Citizen report' }),
        },
        1
      );
      if (!res.ok) throw new Error('Report submission failed.');
      return await res.json();
    } catch {
      usingFallbackMode = true;
      return localFallback.submitReport(payload, token);
    }
  },

  async trackReportStatus(refId: string) {
    if (usingFallbackMode) {
      return localFallback.trackStatus(refId);
    }
    try {
      const res = await fetchJsonWithRetry(
        `/api/reports/${encodeURIComponent(refId.trim().toUpperCase())}/status`,
        undefined,
        1
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Track failed');
      return await res.json();
    } catch {
      usingFallbackMode = true;
      return localFallback.trackStatus(refId);
    }
  },

  async updateIssue(
    issueId: string,
    patch: {
      status?: WorkflowStatus;
      assignedWorker?: string | null;
      officerNotes?: string;
      resolutionNotes?: string;
    },
    token: string | null
  ): Promise<void> {
    if (usingFallbackMode) {
      localFallback.updateIssue(issueId, patch);
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      `/api/issues/${encodeURIComponent(issueId)}`,
      { method: 'PATCH', headers, body: JSON.stringify(patch) },
      1
    );
    if (!res.ok) throw new Error('Update failed');
  },

  async updateWeights(weights: PriorityWeights, token: string | null): Promise<void> {
    if (usingFallbackMode) {
      localFallback.updateWeights(weights);
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      '/api/config/priority-weights',
      { method: 'PUT', headers, body: JSON.stringify(weights) },
      1
    );
    if (!res.ok) throw new Error('Weight update failed');
  },

  async toggleDeviceConnection(deviceId: string, token: string | null): Promise<void> {
    if (usingFallbackMode) {
      localFallback.toggleDevice(deviceId);
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      `/api/devices/${encodeURIComponent(deviceId)}/toggle-connection`,
      { method: 'POST', headers },
      1
    );
    if (!res.ok) throw new Error('Toggle failed');
  },

  async simulateDeviceEvent(
    deviceId: string,
    scenario: string,
    extra: Record<string, unknown> | undefined,
    token: string | null
  ): Promise<{ issue?: RoadIssue }> {
    if (usingFallbackMode) {
      return localFallback.simulateDeviceEvent(deviceId, scenario, extra);
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      `/api/devices/${encodeURIComponent(deviceId)}/simulate-event`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ scenario, ...(extra ?? {}) }),
      },
      1
    );
    if (!res.ok) throw new Error('Simulation failed');
    return await res.json();
  },

  async runAiInference(body: {
    peakG: number;
    durationMs: number;
    ambientCondition: 'Clear Day' | 'Rain / Night';
    hasPhoto: boolean;
  }): Promise<{ simulated: boolean; note: string; analysis: SimulatedDetectionResult }> {
    if (usingFallbackMode) {
      return localFallback.runAiInference(body);
    }
    try {
      const res = await fetchJsonWithRetry(
        '/api/integrations/ai-inference',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        1
      );
      if (!res.ok) throw new Error('Inference failed');
      return await res.json();
    } catch {
      usingFallbackMode = true;
      return localFallback.runAiInference(body);
    }
  },

  async addEvaluationRun(
    payload: {
      runLabel: string;
      roadSegment: string;
      manualCount: number;
      truePositives: number;
      falsePositives: number;
      avgDetectionDelaySec: number;
      speedBreakersTested: number;
      speedBreakersCorrectlyFiltered: number;
      notes: string;
    },
    token: string | null
  ): Promise<void> {
    if (usingFallbackMode) {
      localFallback.addEvaluationRun(payload);
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      '/api/evaluation',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, isSampleSimulated: false }),
      },
      1
    );
    if (!res.ok) throw new Error('Failed to save evaluation run');
  },

  async resetDemo(token: string | null): Promise<void> {
    if (usingFallbackMode) {
      localFallback.resetDemo();
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchJsonWithRetry(
      '/api/demo/reset',
      { method: 'POST', headers },
      1
    );
    if (!res.ok) throw new Error('Reset failed');
  },
};
