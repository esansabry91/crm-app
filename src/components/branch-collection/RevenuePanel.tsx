import { useEffect, useMemo, useState } from 'react';
import { subscribeInvoices, backfillInvoiceBranches, type BackfillBranchResult } from '../../services/invoices';
import { useBranches, useBrands } from '../../hooks/useBranches';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import type { Invoice } from '../../types';
import StatCard from '../analytics/StatCard';
import RevenueTrendChart, { type RevenueTrendPoint } from './RevenueTrendChart';
import { formatRM } from '../../utils/format';

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

type Granularity = 'monthly' | 'quarterly' | 'yearly';
const GRANULARITY_LABEL: Record<Granularity, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

interface MonthRow {
  monthKey: string;
  revenue: number;
  discrepancy: number;
  count: number;
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
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const { brands } = useBrands();
  const { branches } = useBranches();
  const { profile } = useAuth();
  const canFilterByBranch = isAdminRole(profile?.role);
  const [brandFilter, setBrandFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('monthly');
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillBranchResult | null>(null);

  useEffect(() => subscribeInvoices(setInvoices), []);

  async function runBackfill() {
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const result = await backfillInvoiceBranches();
      setBackfillResult(result);
    } finally {
      setBackfillBusy(false);
    }
  }

  const effectiveBranchFilter = canFilterByBranch ? branchFilter : '';

  const filtered = useMemo(
    () =>
      invoices
        .filter((inv) => !brandFilter || inv.brandId === brandFilter)
        .filter((inv) => !effectiveBranchFilter || inv.branchId === effectiveBranchFilter),
    [invoices, brandFilter, effectiveBranchFilter]
  );

  // Per-month totals — the base aggregation the stat tiles, the trend chart, and the month table
  // all build on, so "this month" and the quarterly/yearly rollups can never drift apart.
  const byMonth = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const inv of filtered) {
      const key = monthKeyOf(inv);
      const row = map.get(key) || { monthKey: key, revenue: 0, discrepancy: 0, count: 0 };
      row.revenue += inv.total;
      row.discrepancy += inv.discrepancyAmount || 0;
      row.count += 1;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  }, [filtered]);

  const thisMonthKey = currentMonthKey();
  const thisMonth = byMonth.find((r) => r.monthKey === thisMonthKey) || {
    monthKey: thisMonthKey,
    revenue: 0,
    discrepancy: 0,
    count: 0,
  };

  const overall = useMemo(
    () =>
      filtered.reduce(
        (acc, inv) => {
          acc.revenue += inv.total;
          acc.discrepancy += inv.discrepancyAmount || 0;
          return acc;
        },
        { revenue: 0, discrepancy: 0 }
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
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {canFilterByBranch && (
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input text-sm">
              <option value="">All branches</option>
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
              Clear filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label={`Revenue — ${monthLabel(thisMonthKey)}`} value={formatRM(thisMonth.revenue)} sub={`${thisMonth.count} invoice(s)`} />
          <StatCard
            label={`Discrepancy — ${monthLabel(thisMonthKey)}`}
            value={formatRM(thisMonth.discrepancy)}
            accent={Math.abs(thisMonth.discrepancy) > 0.01 ? '#b45309' : undefined}
          />
          <StatCard label="Total revenue (all time)" value={formatRM(overall.revenue)} sub={`${filtered.length} invoice(s)`} />
          <StatCard
            label="Total discrepancy (all time)"
            value={formatRM(overall.discrepancy)}
            accent={Math.abs(overall.discrepancy) > 0.01 ? '#b45309' : undefined}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Collection over time</h3>
          <div className="flex gap-1">
            {(Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                  granularity === g ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {GRANULARITY_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        <RevenueTrendChart data={chartData} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Monthly breakdown</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">Month</th>
                <th className="py-2 pr-4 font-medium text-right">Invoices</th>
                <th className="py-2 pr-4 font-medium text-right">Revenue (RM)</th>
                <th className="py-2 font-medium text-right">Discrepancy (RM)</th>
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
                  </td>
                </tr>
              ))}
              {byMonth.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-xs text-slate-400">
                    No invoices match these filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canFilterByBranch && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Data maintenance</h3>
          <p className="text-xs text-slate-400 mb-3">
            Invoices saved before the branch filter existed have no branchId, so they're excluded
            whenever a specific branch is selected here or in the Debtor List (they still show up
            fine under "All branches"). This looks up each such invoice's site to fill in its
            branch — safe to run more than once, it only touches invoices still missing branchId.
          </p>
          <button
            onClick={runBackfill}
            disabled={backfillBusy}
            className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
          >
            {backfillBusy ? 'Backfilling…' : 'Backfill branch data for older invoices'}
          </button>
          {backfillResult && (
            <p className="text-xs text-slate-600 mt-2">
              {backfillResult.total === 0
                ? 'Nothing to backfill — every invoice already has a branch.'
                : `Checked ${backfillResult.total} invoice(s) missing branch data: ${backfillResult.updated} updated` +
                  (backfillResult.updatedNameOnly > 0
                    ? ` (${backfillResult.updatedNameOnly} got a branch name but no matching Branch record, so they still won't show under a specific branch filter)`
                    : '') +
                  (backfillResult.skippedNoSite > 0
                    ? `, ${backfillResult.skippedNoSite} skipped (no linked site to derive a branch from)`
                    : '') +
                  '.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
