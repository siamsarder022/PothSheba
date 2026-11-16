import React, { useCallback, useEffect, useState } from 'react';
import type {
  AppStateResponse,
  AuthSessionResponse,
  AuthUser,
  IssueType,
  PriorityWeights,
  PrivacyBlurMethod,
  WorkflowStatus,
} from './types/pothsheba.ts';
import { apiClient, isUsingFallbackMode } from './services/apiClient.ts';
import { AuthorityDashboard } from './components/AuthorityDashboard.tsx';
import { IotAndAiView } from './components/IotAndAiView.tsx';
import { CitizenReportPage } from './components/CitizenReportPage.tsx';
import { EvaluationAndScopeView } from './components/EvaluationAndScopeView.tsx';
import { UserLoginPage } from './components/UserLoginPage.tsx';
import { AdminLoginPage } from './components/AdminLoginPage.tsx';

type ActiveTab =
  | 'user-login'
  | 'admin-login'
  | 'authority'
  | 'iot'
  | 'citizen'
  | 'evaluation';

const TOKEN_STORAGE_KEY = 'ps_auth_token';

export default function App() {
  const [authToken, setAuthToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [myReportIds, setMyReportIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('user-login');

  const [data, setData] = useState<AppStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallbackActive, setFallbackActive] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>('PS-001');

  const fetchState = useCallback(async () => {
    try {
      const json = await apiClient.getState();
      setData(json);
      setFallbackActive(isUsingFallbackMode());
      setSelectedIssueId((prev) => {
        if (prev && json.issues.some((i) => i.id === prev)) return prev;
        return json.issues[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async (token: string | null) => {
    if (!token) {
      setAuthUser(null);
      setMyReportIds([]);
      return;
    }
    const me = await apiClient.getMe(token);
    if (!me) {
      setAuthToken(null);
      setAuthUser(null);
      setMyReportIds([]);
      try {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }
    setAuthUser(me.user);
    setMyReportIds(me.myReportIds ?? []);
    setActiveTab((prev) => {
      if (prev === 'user-login' || prev === 'admin-login') {
        return me.user.role === 'admin' ? 'authority' : 'citizen';
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    refreshSession(authToken);
  }, [authToken, refreshSession]);

  const handleAuthenticated = async (session: AuthSessionResponse) => {
    setAuthToken(session.token);
    setAuthUser(session.user);
    setFallbackActive(isUsingFallbackMode());
    try {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, session.token);
    } catch {
      // ignore
    }
    await refreshSession(session.token);
    setActiveTab(session.user.role === 'admin' ? 'authority' : 'citizen');
  };

  const handleLogout = async () => {
    await apiClient.logout(authToken);
    const wasAdmin = authUser?.role === 'admin';
    setAuthToken(null);
    setAuthUser(null);
    setMyReportIds([]);
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignore
    }
    setActiveTab(wasAdmin ? 'admin-login' : 'user-login');
  };

  const handleUpdateIssue = async (
    issueId: string,
    patch: {
      status?: WorkflowStatus;
      assignedWorker?: string | null;
      officerNotes?: string;
      resolutionNotes?: string;
    }
  ) => {
    await apiClient.updateIssue(issueId, patch, authToken);
    await fetchState();
  };

  const handleUpdateWeights = async (weights: PriorityWeights) => {
    await apiClient.updateWeights(weights, authToken);
    await fetchState();
  };

  const handleToggleDeviceConnection = async (deviceId: string) => {
    await apiClient.toggleDeviceConnection(deviceId, authToken);
    await fetchState();
  };

  const handleSimulateDeviceEvent = async (
    deviceId: string,
    scenario: string,
    extra?: Record<string, unknown>
  ) => {
    const json = await apiClient.simulateDeviceEvent(deviceId, scenario, extra, authToken);
    await fetchState();
    if (json.issue?.id) {
      setSelectedIssueId(json.issue.id);
    }
  };

  const handleCitizenSubmit = async (payload: {
    type: IssueType;
    lat: number;
    lng: number;
    sizeScore: number;
    note: string;
    photoDataUrl?: string;
    privacyBlurApplied: boolean;
    privacyBlurMethod: PrivacyBlurMethod;
  }) => {
    const json = await apiClient.submitReport(payload, authToken);
    await fetchState();
    if (authToken) {
      await refreshSession(authToken);
    }
    if (json.issue?.id) {
      setSelectedIssueId(json.issue.id);
    }
    return json;
  };

  const handleAddEvaluationRun = async (payload: {
    runLabel: string;
    roadSegment: string;
    manualCount: number;
    truePositives: number;
    falsePositives: number;
    avgDetectionDelaySec: number;
    speedBreakersTested: number;
    speedBreakersCorrectlyFiltered: number;
    notes: string;
  }) => {
    await apiClient.addEvaluationRun(payload, authToken);
    await fetchState();
  };

  const handleResetDemo = async () => {
    await apiClient.resetDemo(authToken);
    await fetchState();
  };

  const isAdmin = authUser?.role === 'admin';

  const navItems: { id: ActiveTab; label: string }[] = isAdmin
    ? [
        { id: 'authority', label: 'Authority Map' },
        { id: 'iot', label: 'IoT & AI' },
        { id: 'citizen', label: 'Report Issue' },
        { id: 'evaluation', label: 'Evaluation' },
      ]
    : authUser?.role === 'user'
    ? [
        { id: 'citizen', label: 'Report Issue' },
        { id: 'evaluation', label: 'Evaluation' },
        { id: 'admin-login', label: 'Admin Login' },
      ]
    : [
        { id: 'user-login', label: 'User Login' },
        { id: 'admin-login', label: 'Admin Login' },
        { id: 'citizen', label: 'Report Issue' },
        { id: 'evaluation', label: 'Evaluation' },
      ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3 sm:px-6">
          {/* Zone 1: Single wordmark */}
          <button
            type="button"
            onClick={() =>
              setActiveTab(
                isAdmin ? 'authority' : authUser ? 'citizen' : 'user-login'
              )
            }
            className="text-xl font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            PothSheba
          </button>

          {/* Zone 2: Concise single-line navigation */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`border-b-2 py-1 whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'border-teal-700 font-semibold text-teal-800'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            {authUser ? (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setActiveTab(
                    activeTab === 'user-login' ? 'admin-login' : 'user-login'
                  )
                }
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
              >
                {activeTab === 'user-login' ? 'Admin Login' : 'User Login'}
              </button>
            )}
          </div>
        </div>

        {/* Mobile sub-nav strip (compact single row) */}
        <nav
          aria-label="Mobile navigation"
          className="flex md:hidden items-center gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1.5 text-xs font-medium"
        >
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`rounded-md px-2.5 py-1.5 whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-teal-50 font-semibold text-teal-800'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {fallbackActive && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <span>
              <strong>Browser-Local Demo Mode:</strong> Server API is unavailable in this static preview; data and accounts are saved locally in your browser.
            </span>
            <button
              type="button"
              onClick={fetchState}
              className="font-semibold text-amber-950 underline hover:no-underline whitespace-nowrap"
            >
              Retry Server API
            </button>
          </div>
        )}

        {authUser && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
            <span>
              Signed in as <strong className="text-slate-900">{authUser.name}</strong> ·{' '}
              <span className="font-mono-tabular">{authUser.email}</span> · Role:{' '}
              <strong className="text-teal-800">
                {authUser.role === 'admin' ? 'Authority Officer' : 'Citizen Reporter'}
              </strong>
            </span>
          </div>
        )}

        {activeTab === 'user-login' && (
          <UserLoginPage
            onAuthenticated={handleAuthenticated}
            onSwitchToAdminLogin={() => setActiveTab('admin-login')}
            onContinuePublic={() => setActiveTab('citizen')}
          />
        )}

        {activeTab === 'admin-login' && (
          <AdminLoginPage
            onAuthenticated={handleAuthenticated}
            onSwitchToUserLogin={() => setActiveTab('user-login')}
          />
        )}

        {activeTab !== 'user-login' && activeTab !== 'admin-login' && (
          <>
            {loading && !data ? (
              <div className="space-y-4">
                <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="h-[420px] animate-pulse rounded-xl bg-slate-200 lg:col-span-7" />
                  <div className="h-[420px] animate-pulse rounded-xl bg-slate-200 lg:col-span-5" />
                </div>
              </div>
            ) : data ? (
              <>
                {activeTab === 'authority' &&
                  (isAdmin ? (
                    <AuthorityDashboard
                      data={data}
                      selectedIssueId={selectedIssueId}
                      onSelectIssue={setSelectedIssueId}
                      onUpdateIssue={handleUpdateIssue}
                      onUpdateWeights={handleUpdateWeights}
                      onResetDemo={handleResetDemo}
                      onNavigateDevices={() => setActiveTab('iot')}
                    />
                  ) : (
                    <AdminLoginPage
                      onAuthenticated={handleAuthenticated}
                      onSwitchToUserLogin={() => setActiveTab('user-login')}
                    />
                  ))}

                {activeTab === 'iot' &&
                  (isAdmin ? (
                    <IotAndAiView
                      data={data}
                      onToggleDeviceConnection={handleToggleDeviceConnection}
                      onSimulateDeviceEvent={handleSimulateDeviceEvent}
                    />
                  ) : (
                    <AdminLoginPage
                      onAuthenticated={handleAuthenticated}
                      onSwitchToUserLogin={() => setActiveTab('user-login')}
                    />
                  ))}

                {activeTab === 'citizen' && (
                  <CitizenReportPage
                    data={data}
                    authUser={authUser}
                    serverReportIds={myReportIds}
                    onReportSubmitted={handleCitizenSubmit}
                  />
                )}

                {activeTab === 'evaluation' && (
                  <EvaluationAndScopeView
                    data={data}
                    onAddEvaluationRun={handleAddEvaluationRun}
                  />
                )}
              </>
            ) : null}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-500">
        PothSheba Pilot Prototype · Dhaka Campus Corridor · Group 05 (SE 231 Capstone) · Simulated telemetry and sample data labeled throughout
      </footer>
    </div>
  );
}
