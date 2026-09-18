import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { setLanguage, type AppLanguage } from '../i18n';
import clsx from 'clsx';

/**
 * EN/BM switch for the sign-in screen itself — a visitor here has no profile yet (they aren't
 * signed in), so this only ever writes to the per-browser localStorage fallback via
 * setLanguage(), same as AppLayout's own LanguageToggle when it's called with no uid. Once they
 * do sign in, AuthContext applies their saved profile.language (if any) over this on its own.
 */
function LoginLanguageToggle() {
  const { t, i18n } = useTranslation();
  const current = i18n.language === 'ms' ? 'ms' : 'en';

  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium" role="group" aria-label={t('common.language')}>
      {(['en', 'ms'] as const).map((lang: AppLanguage) => (
        <button
          key={lang}
          type="button"
          onClick={() => setLanguage(lang)}
          className={clsx(
            'px-2 py-1 rounded-md transition',
            current === lang ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          )}
        >
          {lang === 'en' ? 'EN' : 'BM'}
        </button>
      ))}
    </div>
  );
}

export default function LoginPage() {
  const { login, resetPassword } = useAuth();
  const { t } = useTranslation();
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
      setError(t('login.signInError'));
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
        setResetError(t('login.invalidEmail'));
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
          <img
            src="/logo-icon.png"
            alt="Inter Prominent"
            className="mx-auto mb-3 h-14 w-14 rounded-xl object-contain border border-slate-200"
          />
          <h1 className="text-xl font-semibold text-slate-900">{t('login.title')}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {mode === 'signin' ? t('login.signInSubtitle') : t('login.resetSubtitle')}
          </p>
          <div className="mt-3 flex justify-center">
            <LoginLanguageToggle />
          </div>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t('login.email')}</label>
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
                <label className="block text-sm font-medium text-slate-700">{t('login.password')}</label>
                <button
                  type="button"
                  onClick={() => {
                    setMode('reset');
                    setResetSent(false);
                    setResetError(null);
                  }}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {t('login.forgotPassword')}
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
              {submitting ? t('login.signingIn') : t('login.signIn')}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            {resetSent ? (
              <p className="text-sm text-slate-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <Trans
                  i18nKey="login.resetSent"
                  values={{ email: email.trim() || t('login.resetSentFallback') }}
                  components={{ bold: <span className="font-medium" /> }}
                />
              </p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">{t('login.email')}</label>
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
                {resetting ? t('login.sending') : t('login.sendResetLink')}
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
              {t('login.backToSignIn')}
            </button>
          </form>
        )}

        <p className="text-xs text-slate-400 mt-6 text-center">{t('login.footer')}</p>
      </div>
    </div>
  );
}
