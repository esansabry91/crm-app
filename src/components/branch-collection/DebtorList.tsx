import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { subscribeInvoices, computeOutstandingTrend } from '../../services/invoices';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import type { Invoice } from '../../types';
import StatCard from '../analytics/StatCard';
import OutstandingTrendChart from './OutstandingTrendChart';

// Kept in English, matching the Duty Roster's own dateUtils.ts monthLabel() precedent — a plain
// date-formatting utility producing a chart-axis label, not sentence-level UI prose.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Days between the invoice's due date (invoiceDate + paymentTermsDays) and today — negative
 *  means not yet due. */
function daysOverdue(inv: Invoice): number {
  const due = new Date(`${inv.invoiceDate}T00:00:00`);
  due.setDate(due.getDate() + inv.paymentTermsDays);
  const diffMs = Date.now() - due.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

// Bucket ids stay the fixed English literals below (internal filter/state values, also used as
// object keys) — only the displayed label is translated, via bucketLabel()/BUCKET_LABEL_KEYS.
const OVERDUE_BUCKETS = ['Not yet due', '1–30 days', '31–60 days', '61–90 days', '90+ days'] as const;
type OverdueBucket = (typeof OVERDUE_BUCKETS)[number];

function bucketIdFor(overdue: number): OverdueBucket {
  if (overdue <= 0) return 'Not yet due';
  if (overdue <= 30) return '1–30 days';
  if (overdue <= 60) return '31–60 days';
  if (overdue <= 90) return '61–90 days';
  return '90+ days';
}

const BUCKET_LABEL_KEYS: Record<OverdueBucket, string> = {
  'Not yet due': 'branchCollection.debtorList.bucketNotYetDue',
  '1–30 days': 'branchCollection.debtorList.bucket1to30',
  '31–60 days': 'branchCollection.debtorList.bucket31to60',
  '61–90 days': 'branchCollection.debtorList.bucket61to90',
  '90+ days': 'branchCollection.debtorList.bucket90plus',
};

function bucketLabel(overdue: number, t: TFunction): string {
  return t(BUCKET_LABEL_KEYS[bucketIdFor(overdue)]);
}

const BUCKET_ACCENT: Record<OverdueBucket, string> = {
  'Not yet due': '#475569',
  '1–30 days': '#b45309',
  '31–60 days': '#b45309',
  '61–90 days': '#be123c',
  '90+ days': '#be123c',
};

/** Aging report: every invoice not yet fully paid, sorted most-overdue first, with how much is
 *  still outstanding on each. Pulls from the same `invoices` collection InvoiceList reads — this
 *  is purely a different view over it, nothing here is a separate source of truth.
 *
 *  Filterable by brand (everyone) and branch (admin/developer only — see Branch's doc comment in
 *  types.ts for why an invoice may not have a branchId at all, e.g. one generated before this
 *  filter existed or with no linked site). The branch filter is restricted rather than removed
 *  for non-admins because branch managers can otherwise already see every branch's invoices here
 *  (the /invoices read rule is firm-wide for any active non-Payroll user, not branch-scoped) — an
 *  admin-only decision, not a data-access one. */
export default function DebtorList() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { profile } = useAuth();
  const canFilterByBranch = isAdminRole(profile?.role);
  const [brandFilter, setBrandFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState<OverdueBucket | ''>('');

  useEffect(() => subscribeInvoices(setInvoices), []);

  // A non-admin never gets to apply a branch filter — if one was somehow left selected (e.g. the
  // account's role changed mid-session) it stops taking effect rather than silently hiding rows.
  const effectiveBranchFilter = canFilterByBranch ? branchFilter : '';

  const filtered = useMemo(
    () =>
      invoices
        .filter((inv) => !brandFilter || inv.brandId === brandFilter)
        .filter((inv) => !effectiveBranchFilter || inv.branchId === effectiveBranchFilter),
    [invoices, brandFilter, effectiveBranchFilter]
  );

  // Every not-yet-fully-paid invoice with its aging bucket — the base both the bucket stat tiles
  // and the (optionally bucket-filtered) table below are built from, so the tiles' counts always
  // match what clicking "Go to list" on one of them reveals.
  const allOutstanding = useMemo(
    () =>
      filtered
        // A voided invoice was never really owed — see voidInvoice()'s doc comment in
        // services/invoices.ts — so it's dropped here alongside already-paid ones rather than
        // showing up as a phantom debt forever.
        .filter((inv) => inv.status !== 'paid' && inv.status !== 'void')
        .map((inv) => ({ inv, overdue: daysOverdue(inv), balance: inv.total - inv.amountPaid, bucket: bucketIdFor(daysOverdue(inv)) }))
        .sort((a, b) => b.overdue - a.overdue),
    [filtered]
  );

  const bucketCounts = useMemo(() => {
    const counts = Object.fromEntries(OVERDUE_BUCKETS.map((b) => [b, 0])) as Record<OverdueBucket, number>;
    for (const o of allOutstanding) counts[o.bucket]++;
    return counts;
  }, [allOutstanding]);

  const outstanding = allOutstanding.filter((o) => !bucketFilter || o.bucket === bucketFilter);

  const totalOutstanding = outstanding.reduce((sum, o) => sum + o.balance, 0);

  // The trend needs every invoice touched by the current brand/branch filter — including already
  // fully-paid ones — to correctly reconstruct past balances, not just what's still outstanding
  // today (that's what `filtered` is for; `allOutstanding`/`outstanding` above have already
  // dropped paid invoices and don't carry payment history the trend needs).
  const outstandingTrend = useMemo(
    () =>
      computeOutstandingTrend(filtered.filter((inv) => inv.status !== 'void')).map((p) => ({
        key: p.monthKey,
        label: monthLabel(p.monthKey),
        outstanding: p.outstanding,
      })),
    [filtered]
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.debtorList.title', { count: outstanding.length })}</h3>
        <p className="text-sm font-semibold text-slate-800">{t('branchCollection.debtorList.totalOutstanding', { amount: totalOutstanding.toFixed(2) })}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input text-sm">
          <option value="">{t('branchCollection.debtorList.allBrands')}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {canFilterByBranch && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input text-sm">
            <option value="">{t('branchCollection.debtorList.allBranches')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        {bucketFilter && (
          <span className="text-xs font-medium text-slate-600 bg-slate-100 rounded px-2 py-1">
            {t('branchCollection.debtorList.overdueChip', { bucket: t(BUCKET_LABEL_KEYS[bucketFilter]) })}
          </span>
        )}
        {(brandFilter || effectiveBranchFilter || bucketFilter) && (
          <button
            onClick={() => {
              setBrandFilter('');
              setBranchFilter('');
              setBucketFilter('');
            }}
            className="text-xs text-slate-500 hover:underline"
          >
            {t('branchCollection.debtorList.clearFilters')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {OVERDUE_BUCKETS.map((bucket) => (
          <StatCard
            key={bucket}
            label={t(BUCKET_LABEL_KEYS[bucket])}
            value={String(bucketCounts[bucket])}
            accent={BUCKET_ACCENT[bucket]}
            action={{ label: t('branchCollection.debtorList.goToList'), onClick: () => setBucketFilter(bucket) }}
          />
        ))}
      </div>

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-slate-800 mb-3">{t('branchCollection.debtorList.trendTitle')}</h4>
        <OutstandingTrendChart data={outstandingTrend} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-4 font-medium">{t('branchCollection.debtorList.colInvoice')}</th>
              <th className="py-2 pr-4 font-medium">{t('branchCollection.debtorList.colClient')}</th>
              <th className="py-2 pr-4 font-medium">{t('branchCollection.debtorList.colBrand')}</th>
              <th className="py-2 pr-4 font-medium">{t('branchCollection.debtorList.colStatus')}</th>
              <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.debtorList.colTotal')}</th>
              <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.debtorList.colAmountPaid')}</th>
              <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.debtorList.colBalance')}</th>
              <th className="py-2 font-medium text-right">{t('branchCollection.debtorList.colOverdue')}</th>
            </tr>
          </thead>
          <tbody>
            {outstanding.map(({ inv, overdue, balance }) => (
              <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2 pr-4">{inv.invoiceNo}</td>
                <td className="py-2 pr-4">{inv.clientName}</td>
                <td className="py-2 pr-4 text-slate-500">{inv.brandName}</td>
                <td className="py-2 pr-4">{t(`branchCollection.status.${inv.status}`)}</td>
                <td className="py-2 pr-4 text-right">{inv.total.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right">{inv.amountPaid.toFixed(2)}</td>
                <td className="py-2 pr-4 text-right font-medium">{balance.toFixed(2)}</td>
                <td
                  className={`py-2 text-right font-medium ${
                    overdue > 30 ? 'text-rose-600' : overdue > 0 ? 'text-amber-600' : 'text-slate-400'
                  }`}
                >
                  {overdue > 0 ? t('branchCollection.debtorList.overdueDaysPrefix', { count: overdue }) : ''}
                  {bucketLabel(overdue, t)}
                </td>
              </tr>
            ))}
            {outstanding.length === 0 && (
              <tr>
                <td colSpan={8} className="py-4 text-xs text-slate-400">
                  {t('branchCollection.debtorList.noOutstanding')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
