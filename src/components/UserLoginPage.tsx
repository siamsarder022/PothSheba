import React, { useState } from 'react';
import { ArrowRight, ShieldCheck, UserCheck, UserPlus } from 'lucide-react';
import type { AuthSessionResponse } from '../types/pothsheba.ts';
import { apiClient } from '../services/apiClient.ts';

interface UserLoginPageProps {
  onAuthenticated: (session: AuthSessionResponse) => void;
  onSwitchToAdminLogin: () => void;
  onContinuePublic?: () => void;
}

export function UserLoginPage({
  onAuthenticated,
  onSwitchToAdminLogin,
  onContinuePublic,
}: UserLoginPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const session =
        mode === 'login'
          ? await apiClient.loginUser(email, password)
          : await apiClient.registerCitizen(name, email, password);
      onAuthenticated(session);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not connect to the authentication server.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemoCitizen = () => {
    setMode('login');
    setEmail('citizen@pothsheba.local');
    setPassword('citizen123');
    setError(null);
  };

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-8 py-4 lg:grid-cols-12">
      {/* Left Context Panel */}
      <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-6">
        <div className="space-y-4">
          <div className="text-xs font-semibold text-teal-800">
            Citizen Portal · Dhaka Pilot Corridor
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 text-balance">
            Report road hazards and track repairs in one place.
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Sign in or create a citizen account to submit potholes, cracks, waterlogging, overflowing bins, or dark street lights on the pilot map and keep a private list of your submitted references.
          </p>

          <ul className="space-y-2.5 border-t border-slate-100 pt-4 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              <span>
                <strong>Private Report History:</strong> Linked to your account on the server so you can track every report status update.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
              <span>
                <strong>Privacy-Preserving Public Map:</strong> Your name and email are never exposed on public map markers or tracking lookups.
              </span>
            </li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs">
          <button
            type="button"
            onClick={onSwitchToAdminLogin}
            className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-teal-800 hover:underline"
          >
            <span>Authority Officer? Go to Admin Login</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {onContinuePublic && (
            <button
              type="button"
              onClick={onContinuePublic}
              className="font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              Browse public tracker
            </button>
          )}
        </div>
      </section>

      {/* Right Login / Sign Up Form */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 lg:col-span-6">
        <div className="mb-5 flex rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Citizen Log In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
              mode === 'signup'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign Up
          </button>
        </div>

        <h2 className="text-lg font-bold text-slate-900">
          {mode === 'login' ? 'Citizen Sign In' : 'Create Citizen Account'}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {mode === 'login'
            ? 'Enter your citizen credentials to submit and track reports.'
            : 'Register a pilot citizen account. Accounts are stored locally for this prototype.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === 'signup' && (
            <label className="block text-xs font-medium text-slate-700">
              Full Name
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rafiq Ahmed"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>
          )}

          <label className="block text-xs font-medium text-slate-700">
            Email Address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </label>

          <label className="block text-xs font-medium text-slate-700">
            Password
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </label>

          {mode === 'signup' && (
            <label className="block text-xs font-medium text-slate-700">
              Confirm Password
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>
          )}

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
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {mode === 'signup' && <UserPlus className="h-4 w-4" aria-hidden="true" />}
            <span>
              {submitting
                ? 'Please wait...'
                : mode === 'login'
                ? 'Log In as Citizen'
                : 'Create Citizen Account'}
            </span>
          </button>
        </form>

        {/* Demo Account Helper */}
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold text-slate-800">Pilot Demo Citizen Account</div>
              <div className="font-mono-tabular text-[11px] text-slate-600">
                citizen@pothsheba.local · citizen123
              </div>
            </div>
            <button
              type="button"
              onClick={fillDemoCitizen}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              Fill Demo Citizen
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
