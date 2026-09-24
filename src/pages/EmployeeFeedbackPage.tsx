import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { submitEmployeeFeedback, subscribeAllEmployeeFeedback, subscribeEmployeeFeedbackSenders } from '../services/employeeFeedback';
import { formatDateTime } from '../utils/format';
import StatCard from '../components/analytics/StatCard';
import { VIZ } from '../utils/vizColors';
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

// "YYYY-MM" in the viewer's own local time zone — matches the same monthKeyOf()/monthLabel()
// convention InvoiceList.tsx uses for its own Month filter, just keyed off a numeric createdAt
// timestamp instead of a stored date string.
function monthKeyOf(item: EmployeeFeedback): string {
  const d = new Date(item.createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
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
 * Purely presentational — the receiver-only list for one feedback type, already filtered by
 * month/category and matched up with sender identity by EmployeeFeedbackPage below. Only ever
 * mounted when isFeedbackReceiver(profile.role) is true; firestore.rules independently denies
 * the underlying read for every other role regardless of what this component does.
 */
function FeedbackList({
  type,
  items,
  senderById,
  seesSender,
  filtered,
  t,
}: {
  type: FeedbackType;
  items: EmployeeFeedback[];
  senderById: Map<string, EmployeeFeedbackSender>;
  seesSender: boolean;
  /** Whether a month/category filter is currently narrowing this list — changes the empty-state
   *  copy ("no results match these filters" vs. "nothing submitted yet"). */
  filtered: boolean;
  t: TFunction;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        {filtered
          ? t('employeeFeedback.noResultsFiltered')
          : type === 'suggestion'
          ? t('employeeFeedback.noSuggestionsYet')
          : t('employeeFeedback.noComplaintsYet')}
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
 * see the Suggestions/Complaints stat tiles, the Category/Month filters, and the submitted-list
 * below the form; every other role sees the submission form only.
 */
export default function EmployeeFeedbackPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [tab, setTab] = useState<FeedbackType>('suggestion');
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCategory | ''>('');
  const [monthFilter, setMonthFilter] = useState('');
  const [allItems, setAllItems] = useState<EmployeeFeedback[]>([]);
  const [senders, setSenders] = useState<EmployeeFeedbackSender[]>([]);

  const canReceive = isFeedbackReceiver(profile?.role);
  const seesSender = canSeeFeedbackSender(profile?.role);

  // Both subscriptions are receiver-gated client-side too (not just by firestore.rules) so a
  // non-receiver role never even issues a query firestore.rules is just going to deny anyway.
  useEffect(() => {
    if (!canReceive) {
      setAllItems([]);
      return;
    }
    return subscribeAllEmployeeFeedback(setAllItems);
  }, [canReceive]);

  useEffect(() => {
    if (!seesSender) {
      setSenders([]);
      return;
    }
    return subscribeEmployeeFeedbackSenders(setSenders);
  }, [seesSender]);

  const senderById = useMemo(() => new Map(senders.map((s) => [s.id, s])), [senders]);

  // Every month a submission exists in, most recent first — same "build the dropdown's options
  // from what's actually there" convention as InvoiceList.tsx's own Month filter.
  const availableMonths = useMemo(
    () => Array.from(new Set(allItems.map(monthKeyOf))).sort((a, b) => (a < b ? 1 : -1)),
    [allItems]
  );

  // Month + category scoped, but NOT type-scoped — this is what the Suggestions/Complaints stat
  // tiles' counts are built from, so narrowing to one category/month still shows both tiles'
  // counts moving together rather than only the active tab's.
  const scoped = useMemo(
    () =>
      allItems
        .filter((item) => !monthFilter || monthKeyOf(item) === monthFilter)
        .filter((item) => !categoryFilter || item.category === categoryFilter),
    [allItems, monthFilter, categoryFilter]
  );

  const suggestionCount = useMemo(() => scoped.filter((i) => i.type === 'suggestion').length, [scoped]);
  const complaintCount = useMemo(() => scoped.filter((i) => i.type === 'complaint').length, [scoped]);

  const visibleForTab = useMemo(() => scoped.filter((i) => i.type === tab), [scoped, tab]);

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

        {canReceive && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label={t('employeeFeedback.statsSuggestions')}
                value={String(suggestionCount)}
                accent={VIZ.status.good}
                onClick={() => setTab('suggestion')}
              />
              <StatCard
                label={t('employeeFeedback.statsComplaints')}
                value={String(complaintCount)}
                accent={VIZ.status.critical}
                onClick={() => setTab('complaint')}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as FeedbackCategory | '')}
                className="input text-sm w-auto"
              >
                <option value="">{t('employeeFeedback.allCategories')}</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c, t)}
                  </option>
                ))}
              </select>
              <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="input text-sm w-auto">
                <option value="">{t('employeeFeedback.allMonths')}</option>
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              {(categoryFilter || monthFilter) && (
                <button
                  type="button"
                  onClick={() => {
                    setCategoryFilter('');
                    setMonthFilter('');
                  }}
                  className="text-xs text-slate-500 hover:underline"
                >
                  {t('employeeFeedback.clearFilters')}
                </button>
              )}
            </div>
          </div>
        )}

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

        {/* A receiver sees the received list FIRST, then the submission form below it — so
            checking what's already come in doesn't require scrolling past the form every time.
            Every other role never sees a list at all, so their form stays right after the tabs. */}
        {!canReceive && <FeedbackForm type={tab} t={t} />}

        {canReceive && (
          <div>
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              {tab === 'suggestion' ? t('employeeFeedback.receivedSuggestions') : t('employeeFeedback.receivedComplaints')}
            </h2>
            <FeedbackList
              type={tab}
              items={visibleForTab}
              senderById={senderById}
              seesSender={seesSender}
              filtered={!!(categoryFilter || monthFilter)}
              t={t}
            />
          </div>
        )}

        {canReceive && <FeedbackForm type={tab} t={t} />}
      </div>
    </div>
  );
}
