import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { submitEmployeeFeedback, subscribeEmployeeFeedback, subscribeEmployeeFeedbackSenders } from '../services/employeeFeedback';
import { formatDateTime } from '../utils/format';
import { canSeeFeedbackSender, isFeedbackReceiver } from '../types';
import type { EmployeeFeedback, EmployeeFeedbackSender, FeedbackCategory, FeedbackType } from '../types';

const CATEGORIES: FeedbackCategory[] = ['payroll', 'process', 'operation', 'arrangement', 'welfare'];

const CATEGORY_LABEL_KEYS: Record<FeedbackCategory, string> = {
  payroll: 'employeeFeedback.categoryPayroll',
  process: 'employeeFeedback.categoryProcess',
  operation: 'employeeFeedback.categoryOperation',
  arrangement: 'employeeFeedback.categoryArrangement',
  welfare: 'employeeFeedback.categoryWelfare',
};

function categoryLabel(category: FeedbackCategory, t: TFunction): string {
  return t(CATEGORY_LABEL_KEYS[category]);
}

/**
 * The submission form shared by both the Suggestion and Complaint sub-tabs — every role can
 * submit, on either tab. Nothing about the sender is ever sent to Firestore's own
 * /employeeFeedback doc (see submitEmployeeFeedback() in services/employeeFeedback.ts, which
 * writes the sender's identity to a SEPARATE, CEO/Director-only collection instead, in the same
 * writeBatch) — this form itself never even displays anything back that would identify who's
 * submitting, beyond needing their profile to know who to (invisibly) attribute it to.
 */
function FeedbackForm({ type, t }: { type: FeedbackType; t: TFunction }) {
  const { profile } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>('payroll');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isSuggestion = type === 'suggestion';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!message.trim()) {
      setError(t('employeeFeedback.errorMessageRequired'));
      return;
    }
    if (!profile) return;
    setBusy(true);
    try {
      await submitEmployeeFeedback({
        type,
        category,
        message: message.trim(),
        senderUid: profile.uid,
        senderName: profile.name,
      });
      setMessage('');
      setCategory('payroll');
      setSuccess(true);
    } catch (err) {
      setError(t('employeeFeedback.errorCouldNotSubmit'));
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  // Resets the "submitted" confirmation the moment the sender starts a new message or switches
  // sub-tabs, rather than leaving a stale "Thank you" banner sitting above an unrelated draft.
  useEffect(() => {
    setSuccess(false);
    setError(null);
  }, [type]);

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-500">{t('employeeFeedback.categoryLabel')}</label>
        <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} className="input mt-1">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c, t)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">{t('employeeFeedback.messageLabel')}</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            isSuggestion ? t('employeeFeedback.messagePlaceholderSuggestion') : t('employeeFeedback.messagePlaceholderComplaint')
          }
          rows={4}
          className="input mt-1 resize-none"
        />
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{t('employeeFeedback.submitSuccess')}</p>}
      <button
        type="submit"
        disabled={busy}
        className={clsx(
          'px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60',
          isSuggestion ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
        )}
      >
        {busy
          ? t('employeeFeedback.submitting')
          : isSuggestion
          ? t('employeeFeedback.submitSuggestion')
          : t('employeeFeedback.submitComplaint')}
      </button>
    </form>
  );
}

/**
 * The receiver-only inbox for one feedback type — only ever mounted when
 * isFeedbackReceiver(profile.role) is true (see EmployeeFeedbackPage below); firestore.rules
 * independently denies the read for every other role regardless of what this component does.
 * Sender identity (subscribeEmployeeFeedbackSenders) is only ever subscribed to for CEO/Director
 * (see canSeeFeedbackSender()) — every other receiver role never even issues that query.
 */
function FeedbackInbox({ type, t }: { type: FeedbackType; t: TFunction }) {
  const { profile } = useAuth();
  const [items, setItems] = useState<EmployeeFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [senders, setSenders] = useState<EmployeeFeedbackSender[]>([]);
  const seesSender = canSeeFeedbackSender(profile?.role);

  useEffect(() => {
    setLoading(true);
    return subscribeEmployeeFeedback(type, (rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, [type]);

  useEffect(() => {
    if (!seesSender) {
      setSenders([]);
      return;
    }
    return subscribeEmployeeFeedbackSenders(setSenders);
  }, [seesSender]);

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders]);

  if (loading) {
    return <p className="text-sm text-slate-400">{t('employeeFeedback.loading')}</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        {type === 'suggestion' ? t('employeeFeedback.noSuggestionsYet') : t('employeeFeedback.noComplaintsYet')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const sender = senderById.get(item.id);
        return (
          <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                {categoryLabel(item.category, t)}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(item.createdAt)}</span>
            </div>
            <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{item.message}</p>
            <p className="text-xs text-slate-400 mt-2">
              {seesSender
                ? sender
                  ? t('employeeFeedback.senderLabel', { name: sender.senderName })
                  : t('employeeFeedback.loading')
                : t('employeeFeedback.senderAnonymous')}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Reachable by every role (see the /employee-feedback route in App.tsx — no restrictive
 * ProtectedRoute props at all) — anyone can submit a Suggestion (green) or Complaint (red), fully
 * anonymously except to CEO/Director (see canSeeFeedbackSender() in types.ts). Only the 5
 * FEEDBACK_RECEIVER_ROLES (CEO, Director, HQ Admin, Tender Controller, HR Manager) additionally
 * see the FeedbackInbox list below the form; every other role sees the submission form only.
 */
export default function EmployeeFeedbackPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tab, setTab] = useState<FeedbackType>('suggestion');

  const canReceive = isFeedbackReceiver(profile?.role);

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-slate-900">{t('employeeFeedback.title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('employeeFeedback.subtitle')}</p>
      </header>

      <div className="p-6 max-w-2xl mx-auto space-y-5">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800">{t('employeeFeedback.warning')}</p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            onClick={() => setTab('suggestion')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium rounded-md transition',
              tab === 'suggestion' ? 'bg-emerald-600 text-white shadow-sm' : 'text-emerald-700 hover:bg-emerald-50'
            )}
          >
            {t('employeeFeedback.tabs.suggestion')}
          </button>
          <button
            type="button"
            onClick={() => setTab('complaint')}
            className={clsx(
              'px-4 py-1.5 text-sm font-medium rounded-md transition',
              tab === 'complaint' ? 'bg-rose-600 text-white shadow-sm' : 'text-rose-700 hover:bg-rose-50'
            )}
          >
            {t('employeeFeedback.tabs.complaint')}
          </button>
        </div>

        <FeedbackForm type={tab} t={t} />

        {canReceive && (
          <div className="pt-2">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              {tab === 'suggestion' ? t('employeeFeedback.receivedSuggestions') : t('employeeFeedback.receivedComplaints')}
            </h2>
            <FeedbackInbox type={tab} t={t} />
          </div>
        )}
      </div>
    </div>
  );
}
