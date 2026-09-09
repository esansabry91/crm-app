import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError('Could not sign in. Check your email and password and try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetting(true);
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err) {
      // Firebase deliberately doesn't reveal whether the email exists — show a generic
      // success-shaped message either way, but still surface truly invalid input.
      const code = (err as { code?: string })?.code;
      if (code === 'auth/invalid-email') {
        setResetError('Enter a valid email address first.');
      } else {
        setResetSent(true);
      }
      console.error(err);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 h-11 w-16 rounded-xl bg-blue-600 text-white flex items-center justify-center font-semibold text-base">
            IPSB
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Tender Pipeline CRM</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'signin' ? 'Sign in with your team account' : 'Reset your password'}
          </p>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="you@gmail.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">Password</label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setResetSent(false);
                    setResetError(null);
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {resetSent ? (
              <p className="text-sm text-slate-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                If an account exists for <span className="font-medium">{email.trim() || 'that address'}</span>, a
                password reset link has been sent. Check your inbox (and spam folder).
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="you@gmail.com"
                />
              </div>
            )}
            {resetError && <p className="text-sm text-rose-600">{resetError}</p>}
            {!resetSent && (
              <button
                type="submit"
                disabled={resetting}
                className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
              >
                {resetting ? 'Sending…' : 'Send reset link'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setResetError(null);
              }}
              className="w-full text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        <p className="text-xs text-slate-400 mt-6 text-center">
          Accounts are created by your HQ admin. Contact them if you need access.
        </p>
      </div>
    </div>
  );
}
