import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  subscribeInvoices,
  backfillInvoiceBranches,
  diagnoseInvoiceBranches,
  backfillInvoiceStatuses,
  getInvoiceSiteAllocations,
  type BackfillBranchResult,
  type InvoiceBranchDiagnostic,
  type BackfillStatusResult,
} from '../../services/invoices';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import type { Invoice } from '../../types';
import StatCard from '../analytics/StatCard';
import RevenueTrendChart, { type RevenueTrendPoint } from './RevenueTrendChart';
import { formatRM } from '../../utils/format';

// Kept in English, matching DebtorList's own monthLabel() precedent — a plain date-formatting
// utility producing a chart-axis/table label, not sentence-level UI prose.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The yyyy-mm billing-month key an invoice belongs to for revenue grouping — prefers the
 *  invoice's own billingMonthKey, added alongside this feature, and falls back to invoiceDate's
 *  own month for invoices saved before that field existed. */
function monthKeyOf(inv: Invoice): string {
  return inv.billingMonthKey || (inv.invoiceDate || '').slice(0, 7) || 'unknown';
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function quarterKeyOf(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

function yearKeyOf(monthKey: string): string {
  return monthKey.split('-')[0] || monthKey;
}

// Granularity itself stays the fixed English literal (internal state) — only the displayed
// label is translated, via GRANULARITY_LABEL_KEYS.
type Granularity = 'monthly' | 'quarterly' | 'yearly';
const GRANULARITY_LABEL_KEYS: Record<Granularity, string> = {
  monthly: 'branchCollection.revenuePanel.granularityMonthly',
  quarterly: 'branchCollection.revenuePanel.granularityQuarterly',
  yearly: 'branchCollection.revenuePanel.granularityYearly',
};

interface MonthRow {
  monthKey: string;
  revenue: number;
  discrepancy: number;
  count: number;
  /** Of `count`, how many actually have a discrepancy figure to add up (see
   *  Invoice.discrepancyAmount's doc comment — null whenever there was nothing confirmed on Duty
   *  Roster to compare against). An invoice with nothing to check contributes 0 to `discrepancy`
   *  the same way a confirmed, genuinely-zero discrepancy would — this is what tells those two
   *  apart, since "Total discrepancy: RM 0" alone can't. */
  checkedCount: number;
}

interface SiteRow {
  siteId: string | null;
  siteName: string;
  /** This site's share of revenue across every matching invoice — see
   *  getInvoiceSiteAllocations()'s doc comment in services/invoices.ts for how a combined
   *  invoice's total is split across the sites it billed. */
  revenue: number;
  /** How many invoices touched this site at all (fully, or as one site of a combined invoice) —
   *  NOT how many invoices exist overall, so these counts across every site row can add up to
   *  more than the total invoice count whenever combined invoicing is in play. */
  invoiceCount: number;
}

/**
 * Revenue tab: every saved invoice's total (and any Duty Roster reconciliation discrepancy
 * snapshotted onto it at save time — see Invoice.discrepancyAmount's doc comment) rolled up by
 * billing month, with the current month called out, a monthly/quarterly/yearly trend chart, and
 * the same brand/branch filtering pattern as the Debtor List (branch filter admin-only — see
 * DebtorList's doc comment for why that's a UI restriction, not a data-access one).
 *
 * "Revenue" here means invoiced amount (accrual — the moment an invoice is generated), not cash
 * actually collected — that's what the Debtor List/Invoices tab's amountPaid already tracks.
 */
export default function RevenuePanel() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { profile } = useAuth();
  const canFilterByBranch = isAdminRole(profile?.role);
  // The branch filter itself stays admin-only (per the original spec), but the backfill/
  // diagnostics tools below it are safe for a Branch Manager to run too — firestore.rules
  // already lets a Branch Manager create/update invoices, and their read of `sites` is
  // naturally branch-scoped there, so running this only ever touches data they can already
  // reach.
  const canManageInvoiceData = canFilterByBranch || profile?.role === 'branchManager';
  const [brandFilter, setBrandFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillBranchResult | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<InvoiceBranchDiagnostic[] | null>(null);
  const [statusFixBusy, setStatusFixBusy] = useState(false);
  const [statusFixResult, setStatusFixResult] = useState<BackfillStatusResult | null>(null);

  useEffect(() => subscribeInvoices(setInvoices), []);

  async function runBackfill() {
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const result = await backfillInvoiceBranches();
      setBackfillResult(result);
      // Refresh the diagnostic list too, if it's open, so a re-run's effect is visible immediately.
      if (diagnostics) setDiagnostics(await diagnoseInvoiceBranches());
    } finally {
      setBackfillBusy(false);
    }
  }

  async function runDiagnostics() {
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(await diagnoseInvoiceBranches());
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function runStatusFix() {
    setStatusFixBusy(true);
    setStatusFixResult(null);
    try {
      setStatusFixResult(await backfillInvoiceStatuses());
    } finally {
      setStatusFixBusy(false);
    }
  }

  const effectiveBranchFilter = canFilterByBranch ? branchFilter : '';

  // The branch filter's value is a branchId, matched directly against Invoice.branchId. As a
  // safety net for invoices where that backfill hasn't (yet) resolved a branchId — see the "Data
  // maintenance" section below — an invoice whose plain-text branchName matches the selected
  // branch's name (case/whitespace-insensitively) still counts, so a name mismatch never silently
  // drops a real invoice out of the total the way it did before this fallback existed.
  const selectedBranchName = branches.find((b) => b.id === effectiveBranchFilter)?.name;
  const filtered = useMemo(
    () =>
      invoices
        // A voided invoice was wrongly generated and cancelled — see voidInvoice()'s doc comment
        // in services/invoices.ts — so it never counted as real revenue and is dropped here,
        // ahead of every rollup below (byMonth/overall) that builds on `filtered`.
        .filter((inv) => inv.status !== 'void')
        .filter((inv) => !brandFilter || inv.brandId === brandFilter)
        .filter(
          (inv) =>
            !effectiveBranchFilter ||
            inv.branchId === effectiveBranchFilter ||
            (!inv.branchId &&
              !!inv.branchName &&
              !!selectedBranchName &&
              inv.branchName.trim().toLowerCase() === selectedBranchName.trim().toLowerCase())
        ),
    [invoices, brandFilter, effectiveBranchFilter, selectedBranchName]
  );

  // Per-month totals — the base aggregation the stat tiles, the trend chart, and the month table
  // all build on, so "this month" and the quarterly/yearly rollups can never drift apart.
  const byMonth = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const inv of filtered) {
      const key = monthKeyOf(inv);
      const row = map.get(key) || { monthKey: key, revenue: 0, discrepancy: 0, count: 0, checkedCount: 0 };
      row.revenue += inv.total;
      row.discrepancy += inv.discrepancyAmount || 0;
      row.count += 1;
      if (inv.discrepancyAmount != null) row.checkedCount += 1;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  }, [filtered]);

  // Revenue attributed to each site touched by the (brand/branch-filtered) invoices above —
  // see getInvoiceSiteAllocations()'s doc comment for how a combined invoice's total is split
  // across the sites it billed. All-time, same scope as the "Total revenue (all time)" stat card
  // below, so the two stay mutually consistent (this table's revenue column sums to that figure).
  const bySite = useMemo(() => {
    const map = new Map<string, SiteRow>();
    for (const inv of filtered) {
      for (const alloc of getInvoiceSiteAllocations(inv)) {
        // Invoices migrated from before the CRM tracked a Duty Roster site (see
        // createMigratedInvoice()) carry no siteId/siteName — they're tied to a whole
        // project/client instead. Falling back to the invoice's own clientName there (rather
        // than a generic "Unknown site" label) keeps this table meaningful for those rows; the
        // translated fallback only kicks in for the rarer case where even clientName is blank.
        const displayName = alloc.siteName || inv.clientName || t('branchCollection.revenuePanel.unknownSite');
        const key = alloc.siteId || `name:${displayName}`;
        const row = map.get(key) || {
          siteId: alloc.siteId,
          siteName: displayName,
          revenue: 0,
          invoiceCount: 0,
        };
        row.revenue += alloc.amount;
        row.invoiceCount += 1;
        map.set(key, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filtered, t]);

  const thisMonthKey = currentMonthKey();
  const thisMonth = byMonth.find((r) => r.monthKey === thisMonthKey) || {
    monthKey: thisMonthKey,
    revenue: 0,
    discrepancy: 0,
    count: 0,
    checkedCount: 0,
  };

  const overall = useMemo(
    () =>
      filtered.reduce(
        (acc, inv) => {
          acc.revenue += inv.total;
          acc.discrepancy += inv.discrepancyAmount || 0;
          if (inv.discrepancyAmount != null) acc.checkedCount += 1;
          return acc;
        },
        { revenue: 0, discrepancy: 0, checkedCount: 0 }
      ),
    [filtered]
  );

  const chartData: RevenueTrendPoint[] = useMemo(() => {
    const keyFn =
      granularity === 'monthly'
        ? (r: MonthRow) => r.monthKey
        : granularity === 'quarterly'
        ? (r: MonthRow) => quarterKeyOf(r.monthKey)
        : (r: MonthRow) => yearKeyOf(r.monthKey);
    const map = new Map<string, RevenueTrendPoint>();
    for (const row of byMonth) {
      const k = keyFn(row);
      const entry = map.get(k) || { key: k, label: k, revenue: 0, discrepancy: 0 };
      entry.revenue += row.revenue;
      entry.discrepancy += row.discrepancy;
      map.set(k, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((e) => ({ ...e, label: granularity === 'monthly' ? monthLabel(e.key) : e.key }));
  }, [byMonth, granularity]);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input text-sm">
            <option value="">{t('branchCollection.revenuePanel.allBrands')}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {canFilterByBranch && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input text-sm">
              <option value="">{t('branchCollection.revenuePanel.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          {(brandFilter || effectiveBranchFilter) && (
            <button
              onClick={() => {
                setBrandFilter('');
                setBranchFilter('');
              }}
              className="text-xs text-slate-500 hover:underline"
            >
              {t('branchCollection.revenuePanel.clearFilters')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label={t('branchCollection.revenuePanel.revenueLabel', { month: monthLabel(thisMonthKey) })}
            value={formatRM(thisMonth.revenue)}
            sub={t('branchCollection.revenuePanel.invoiceCountSub', { count: thisMonth.count })}
          />
          <StatCard
            label={t('branchCollection.revenuePanel.discrepancyLabel', { month: monthLabel(thisMonthKey) })}
            value={formatRM(thisMonth.discrepancy)}
            sub={t('branchCollection.revenuePanel.discrepancyCheckedSub', { checked: thisMonth.checkedCount, count: thisMonth.count })}
            accent={Math.abs(thisMonth.discrepancy) > 0.01 ? '#b45309' : undefined}
          />
          <StatCard
            label={t('branchCollection.revenuePanel.totalRevenueAllTime')}
            value={formatRM(overall.revenue)}
            sub={t('branchCollection.revenuePanel.invoiceCountSub', { count: filtered.length })}
          />
          <StatCard
            label={t('branchCollection.revenuePanel.totalDiscrepancyAllTime')}
            value={formatRM(overall.discrepancy)}
            sub={t('branchCollection.revenuePanel.discrepancyCheckedSub', { checked: overall.checkedCount, count: filtered.length })}
            accent={Math.abs(overall.discrepancy) > 0.01 ? '#b45309' : undefined}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.revenuePanel.collectionOverTime')}</h3>
          <div className="flex gap-1">
            {(Object.keys(GRANULARITY_LABEL_KEYS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                  granularity === g ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {t(GRANULARITY_LABEL_KEYS[g])}
              </button>
            ))}
          </div>
        </div>
        <RevenueTrendChart data={chartData} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('branchCollection.revenuePanel.monthlyBreakdown')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">{t('branchCollection.revenuePanel.colMonth')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colInvoices')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colRevenueRM')}</th>
                <th className="py-2 font-medium text-right">{t('branchCollection.revenuePanel.colDiscrepancyRM')}</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.map((row) => (
                <tr key={row.monthKey} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4">{monthLabel(row.monthKey)}</td>
                  <td className="py-2 pr-4 text-right">{row.count}</td>
                  <td className="py-2 pr-4 text-right font-medium">{row.revenue.toFixed(2)}</td>
                  <td className={`py-2 text-right ${Math.abs(row.discrepancy) > 0.01 ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                    {row.discrepancy.toFixed(2)}
                    <span className="text-slate-300 font-normal"> {t('branchCollection.revenuePanel.checkedFraction', { checked: row.checkedCount, count: row.count })}</span>
                  </td>
                </tr>
              ))}
              {byMonth.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-xs text-slate-400">
                    {t('branchCollection.revenuePanel.noneMatchFilters')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.revenuePanel.revenueBySite')}</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">
          {t('branchCollection.revenuePanel.revenueBySiteDesc')}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">{t('branchCollection.revenuePanel.colSite')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colInvoices')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colRevenueRM')}</th>
                <th className="py-2 font-medium text-right">{t('branchCollection.revenuePanel.colPercentOfTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {bySite.map((row) => (
                <tr key={row.siteId || row.siteName} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4">{row.siteName}</td>
                  <td className="py-2 pr-4 text-right">{row.invoiceCount}</td>
                  <td className="py-2 pr-4 text-right font-medium">{row.revenue.toFixed(2)}</td>
                  <td className="py-2 text-right text-slate-500">
                    {overall.revenue > 0 ? `${((row.revenue / overall.revenue) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
              {bySite.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-xs text-slate-400">
                    {t('branchCollection.revenuePanel.noneMatchFilters')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canManageInvoiceData && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">{t('branchCollection.revenuePanel.dataMaintenance')}</h3>
          <p className="text-xs text-slate-400 mb-3">
            {t('branchCollection.revenuePanel.dataMaintenanceDesc')}
          </p>
          <button
            onClick={runBackfill}
            disabled={backfillBusy}
            className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
          >
            {backfillBusy ? t('branchCollection.revenuePanel.backfillingEllipsis') : t('branchCollection.revenuePanel.backfillButton')}
          </button>
          {backfillResult && (
            <p className="text-xs text-slate-600 mt-2">
              {backfillResult.total === 0
                ? t('branchCollection.revenuePanel.backfillNothingToDo')
                : [
                    t('branchCollection.revenuePanel.backfillResultChecked', {
                      total: backfillResult.total,
                      updated: backfillResult.updated,
                    }),
                    backfillResult.updatedNameOnly > 0
                      ? t('branchCollection.revenuePanel.backfillResultNameOnly', { count: backfillResult.updatedNameOnly })
                      : '',
                    backfillResult.skippedNoSite > 0
                      ? t('branchCollection.revenuePanel.backfillResultSkipped', { count: backfillResult.skippedNoSite })
                      : '',
                  ].join('') + '.'}
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-slate-100">
            <button
              onClick={runDiagnostics}
              disabled={diagnosticsBusy}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg"
            >
              {diagnosticsBusy ? t('branchCollection.revenuePanel.checkingEllipsis') : t('branchCollection.revenuePanel.diagnosticsButton')}
            </button>
            {diagnostics && (
              diagnostics.length === 0 ? (
                <p className="text-xs text-slate-600 mt-2">{t('branchCollection.revenuePanel.diagnosticsAllMatched')}</p>
              ) : (
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400 border-b border-slate-100">
                        <th className="py-1.5 pr-3 font-medium">{t('branchCollection.debtorList.colInvoice')}</th>
                        <th className="py-1.5 pr-3 font-medium">{t('branchCollection.revenuePanel.colSite')}</th>
                        <th className="py-1.5 pr-3 font-medium">{t('branchCollection.revenuePanel.colBranchNameOnFile')}</th>
                        <th className="py-1.5 font-medium">{t('branchCollection.revenuePanel.colWhyUnmatched')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.map((row) => (
                        <tr key={row.invoiceId} className="border-b border-slate-50 last:border-0">
                          <td className="py-1.5 pr-3 font-medium text-slate-700">{row.invoiceNo}</td>
                          <td className="py-1.5 pr-3">{row.siteName || '—'}</td>
                          <td className="py-1.5 pr-3">{row.branchName || '—'}</td>
                          <td className="py-1.5 text-amber-700">{row.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <button
              onClick={runStatusFix}
              disabled={statusFixBusy}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg"
            >
              {statusFixBusy ? t('branchCollection.revenuePanel.checkingEllipsis') : t('branchCollection.revenuePanel.statusFixButton')}
            </button>
            <p className="text-xs text-slate-400 mt-2">
              {t('branchCollection.revenuePanel.statusFixDesc')}
            </p>
            {statusFixResult && (
              <p className="text-xs text-slate-600 mt-2">
                {statusFixResult.updated === 0
                  ? t('branchCollection.revenuePanel.statusFixNothingToDo', { total: statusFixResult.total })
                  : t('branchCollection.revenuePanel.statusFixUpdated', { total: statusFixResult.total, updated: statusFixResult.updated })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
