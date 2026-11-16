import React, { useState } from 'react';
import { ArrowLeft, Lock, ShieldAlert } from 'lucide-react';
import type { AuthSessionResponse } from '../types/pothsheba.ts';
import { apiClient } from '../services/apiClient.ts';

interface AdminLoginPageProps {
  onAuthenticated: (session: AuthSessionResponse) => void;
  onSwitchToUserLogin: () => void;
}

export function AdminLoginPage({
  onAuthenticated,
  onSwitchToUserLogin,
}: AdminLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const session = await apiClient.loginAdmin(email, password);
      onAuthenticated(session);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not connect to the authentication server.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemoOfficer = () => {
    setEmail('officer@pothsheba.local');
    setPassword('officer123');
    setError(null);
  };

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-8 py-4 lg:grid-cols-12">
      {/* Left Authority Context Panel */}
      <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-900 p-6 text-slate-100 sm:p-8 lg:col-span-6">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-teal-300">
            Authority Operations Access · Dhaka Pilot
          </div>
          <h1 className="text-3xl font-extrabold text-white text-balance">
            Officer Dashboard &amp; Repair Priority Control
          </h1>
          <p className="text-sm leading-relaxed text-slate-300">
            Authorized pilot officers use this portal to review unconfirmed detections, assign field crews, update workflow states, tune priority weights, manage simulated sensor nodes, and record field evaluation counts.
          </p>

          <div className="space-y-2 border-t border-slate-800 pt-4 text-xs text-slate-300">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <span>
                <strong>Prototype Authentication Notice:</strong> Uses server-side scrypt password hashing and local JSON session storage for pilot testing. Connect institutional SSO / IAM before any live authority deployment.
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-800 pt-4 text-xs">
          <button
            type="button"
            onClick={onSwitchToUserLogin}
            className="inline-flex items-center gap-1.5 font-semibold text-teal-300 hover:text-white hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Citizen reporter? Go to User Login Page</span>
          </button>
        </div>
      </section>

      {/* Right Admin Login Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-6">
        <div className="mb-4 flex items-center gap-2 text-slate-900">
          <Lock className="h-5 w-5 text-slate-800" aria-hidden="true" />
          <h2 className="text-lg font-bold">Admin / Officer Sign In</h2>
        </div>
        <p className="text-xs text-slate-500">
          Sign in with an officer account to unlock authority mutations, device controls, and evaluation logging.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-xs font-medium text-slate-700">
            Officer Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@pothsheba.local"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </label>

          <label className="block text-xs font-medium text-slate-700">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter officer password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Verifying Officer Session...' : 'Log In to Authority Dashboard'}
          </button>
        </form>

        {/* Demo Officer Credentials Helper */}
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-slate-800">Pilot Demo Officer Account</div>
              <div className="font-mono-tabular text-[11px] text-slate-600">
                officer@pothsheba.local · officer123
              </div>
            </div>
            <button
              type="button"
              onClick={fillDemoOfficer}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              Fill Demo Officer
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
