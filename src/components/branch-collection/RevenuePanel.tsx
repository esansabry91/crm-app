import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { useLiveGuardCountsByTender, useWonTenders } from '../../hooks/useActiveProjects';
import { subscribeReachableSites } from '../../services/reachableSites';
import { useAuth } from '../../contexts/AuthContext';
import { isAdminRole } from '../../types';
import type { Invoice, Tender } from '../../types';
import StatCard from '../analytics/StatCard';
import RevenueTrendChart, { type RevenueTrendPoint } from './RevenueTrendChart';
import ProjectDetailsModal from '../active-projects/ProjectDetailsModal';
import { formatDate, formatRM } from '../../utils/format';

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

/** One Duty Roster site linked to a project, for the invoice-submission checklist below —
 *  intentionally minimal (id + name only) since the checklist only needs to know a project's
 *  site count and enumerate them, not anything about guards/branch/etc. */
interface ChecklistSite {
  id: string;
  name: string;
}

/** One project's (or, when split, one site's) row in the invoice-submission checklist — see the
 *  invoiceChecklist useMemo's doc comment for exactly when a project splits into per-site rows. */
interface ChecklistSiteRow {
  siteId: string;
  siteName: string;
  submitted: boolean;
  invoiceCount: number;
}

interface ChecklistProjectRow {
  tenderId: string;
  projectName: string;
  /** Present only when this project's sites are being invoiced separately for the selected month
   *  (or haven't been invoiced at all yet) — one entry per Duty Roster site. Null for a
   *  single-site project, or when one invoice already covers every one of its sites together, in
   *  which case the project itself is the row (see `submitted`/`invoiceCount` below). */
  siteRows: ChecklistSiteRow[] | null;
  /** Whether this project's invoicing for the month is fully done — for a project with
   *  siteRows, true only once every site row is submitted. */
  submitted: boolean;
  /** Total invoices matched to this project (by tenderId) for the selected month — meaningless
   *  as a per-site breakdown when siteRows is set, so only rendered for the collapsed case. */
  invoiceCount: number;
}

interface SiteRow {
  siteId: string | null;
  /** The Active Project this row belongs to, when resolvable — set directly from the invoice's
   *  own tenderId for a Manual-Invoice-grouped row (see the bySite useMemo's doc comment below),
   *  or looked up via the site's own tenderId link for an ordinary site-tied row. Null only when
   *  neither resolves (e.g. a site that's since been deleted). Powers the "Details" link and
   *  Contract Start column in the Revenue by site table. */
  tenderId: string | null;
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
  // Resolves a migrated/historical invoice's tenderId to its Active Project's current name for
  // the Revenue by site table below — see bySite's own doc comment. useWonTenders() returns every
  // Won tender regardless of closedOut, so this still resolves a project that's since moved to
  // Past Projects.
  const { wonTenders, seesAllBranches } = useWonTenders(profile);
  const tenderNameById = useMemo(() => new Map(wonTenders.map((wt) => [wt.id, wt.clientName])), [wonTenders]);
  // Full project records by id — every Won tender regardless of closedOut (same as
  // tenderNameById above), so the "Details" link and Contract Start column in Revenue by site
  // below still resolve a project that's since moved to Past Projects.
  const tenderById = useMemo(() => new Map(wonTenders.map((wt) => [wt.id, wt])), [wonTenders]);
  // Live guard count + the project record itself, both needed to open the same ProjectDetailsModal
  // Active Projects uses, from the "Details" link on each Revenue by site row below.
  const liveGuardCounts = useLiveGuardCountsByTender(profile, seesAllBranches);
  const [detailsTender, setDetailsTender] = useState<Tender | null>(null);
  const canFilterByBranch = isAdminRole(profile?.role);
  // The branch filter itself stays admin-only (per the original spec), but the backfill/
  // diagnostics tools below it are safe for a Branch Manager to run too — firestore.rules
  // already lets a Branch Manager create/update invoices, and getReachableSites() only LISTs
  // sites they can actually read (own branch + unassigned), so running this only ever resolves
  // invoices against data they can already reach.
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
    if (!profile) return;
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const result = await backfillInvoiceBranches(profile);
      setBackfillResult(result);
      // Refresh the diagnostic list too, if it's open, so a re-run's effect is visible immediately.
      if (diagnostics) setDiagnostics(await diagnoseInvoiceBranches(profile));
    } finally {
      setBackfillBusy(false);
    }
  }

  async function runDiagnostics() {
    if (!profile) return;
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(await diagnoseInvoiceBranches(profile));
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

  // Every Duty Roster site this profile can reach, subscribed once and split into two lookups:
  // sitesByTender (currently-linked, non-archived sites grouped by tenderId — what the invoice
  // checklist below needs to enumerate a project's live sites) and siteToTenderId (every site,
  // archived included, mapped back to its tenderId — what Revenue by site below needs to resolve
  // an ordinary site-tied row to its project, even one whose site has since been archived or
  // whose project has since closed out). Uses the same "everything this profile can LIST" plan as
  // useLiveGuardCountsByTender (Active Projects' own guard-count source) rather than
  // useTenderSites (which is scoped to one tenderId at a time, for a single open modal).
  const [sitesByTender, setSitesByTender] = useState<Map<string, ChecklistSite[]>>(new Map());
  const [siteToTenderId, setSiteToTenderId] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!profile) {
      setSitesByTender(new Map());
      setSiteToTenderId(new Map());
      return;
    }
    return subscribeReachableSites(
      profile,
      (docs) => {
        const byTender = new Map<string, ChecklistSite[]>();
        const toTenderId = new Map<string, string>();
        for (const d of docs) {
          const data = d.data() as { name?: string; tenderId?: string | null; archived?: boolean };
          if (!data.tenderId) continue;
          toTenderId.set(d.id, data.tenderId);
          if (data.archived) continue;
          const list = byTender.get(data.tenderId) || [];
          list.push({ id: d.id, name: data.name || 'Untitled site' });
          byTender.set(data.tenderId, list);
        }
        byTender.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
        setSitesByTender(byTender);
        setSiteToTenderId(toTenderId);
      },
      (err) => console.error('RevenuePanel sites subscription error', err)
    );
  }, [profile]);

  // Revenue attributed to each site (or, for a migrated/historical invoice, each Active Project)
  // touched by the (brand/branch-filtered) invoices above — see getInvoiceSiteAllocations()'s doc
  // comment for how a combined invoice's total is split across the sites it billed. All-time, same
  // scope as the "Total revenue (all time)" stat card below, so the two stay mutually consistent
  // (this table's revenue column sums to that figure).
  //
  // A "New Invoice" (generated from Duty Roster) is always tied to a specific site — those rows
  // group by alloc.siteId exactly as before, resolved back to their project via siteToTenderId
  // for the Contract Start column and "Details" link. A "Manual Invoice" (see
  // createMigratedInvoice(), the Generate Invoice tab formerly labeled "Add historical invoice")
  // carries no Duty Roster site at all — alloc.siteId is null for it — because it's tied to a
  // whole Active Project (tenderId) instead, so those rows group by tenderId, resolved to that
  // project's current client name via tenderNameById. Grouping by the id (not by clientName text)
  // means two migrated invoices for the same project always land in the same row even if their
  // typed-in clientName ever drifted slightly; falling back to the invoice's own clientName only
  // kicks in if the project itself isn't resolvable (e.g. no longer visible to this viewer), and
  // the translated placeholder only if even that's blank.
  const bySite = useMemo(() => {
    const map = new Map<string, SiteRow>();
    for (const inv of filtered) {
      for (const alloc of getInvoiceSiteAllocations(inv)) {
        const isProjectTied = !alloc.siteId;
        const displayName = isProjectTied
          ? (inv.tenderId && tenderNameById.get(inv.tenderId)) || inv.clientName || t('branchCollection.revenuePanel.unknownSite')
          : alloc.siteName;
        const key = isProjectTied ? `tender:${inv.tenderId || displayName}` : `site:${alloc.siteId}`;
        const row = map.get(key) || {
          siteId: alloc.siteId,
          tenderId: isProjectTied ? inv.tenderId : (alloc.siteId && siteToTenderId.get(alloc.siteId)) || null,
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
  }, [filtered, t, tenderNameById, siteToTenderId]);

  const [checklistMonth, setChecklistMonth] = useState(() => currentMonthKey());

  // Active (not closed-out) projects in scope for the checklist — same brand/branch filters as
  // the rest of this panel, so switching a filter above narrows the checklist too, PLUS a
  // contractStart cutoff: a project whose contract hasn't started yet as of the selected month
  // has no invoicing to expect yet, so it stays off the checklist entirely for that month rather
  // than showing as a permanent, misleading "Not submitted" from the month it was first Won
  // onward. A project with no contractStart on file (shouldn't normally happen — see Tender's
  // own contractStart field) is kept rather than hidden, so a data gap never silently drops it.
  const activeProjectsForChecklist = useMemo(
    () =>
      wonTenders
        .filter((tnd) => !tnd.closedOut)
        .filter((tnd) => !brandFilter || tnd.brandId === brandFilter)
        .filter((tnd) => !effectiveBranchFilter || tnd.activeBranch === effectiveBranchFilter)
        .filter((tnd) => !tnd.contractStart || tnd.contractStart.slice(0, 7) <= checklistMonth),
    [wonTenders, brandFilter, effectiveBranchFilter, checklistMonth]
  );

  // Which active projects have had their invoice(s) submitted for the selected month, and which
  // haven't yet — one row per project, EXCEPT a multi-site project whose sites are being invoiced
  // separately this month (or haven't been invoiced at all yet), which expands into one row per
  // site nested under it. A project's sites stay collapsed into a single row only when one
  // invoice already reaches every one of them together: either a combined invoice (see
  // InvoiceSiteBill's doc comment in types.ts) whose additionalSiteBills cover every site, or a
  // Manual Invoice (see createMigratedInvoice()), which — having no Duty Roster site at all — is
  // inherently a whole-project submission rather than any one site's.
  const invoiceChecklist = useMemo<ChecklistProjectRow[]>(() => {
    const rows = activeProjectsForChecklist.map((project): ChecklistProjectRow => {
      const monthInvoices = filtered.filter((inv) => inv.tenderId === project.id && monthKeyOf(inv) === checklistMonth);
      const sites = sitesByTender.get(project.id) || [];
      const invoiceCount = monthInvoices.length;

      if (sites.length <= 1) {
        return { tenderId: project.id, projectName: project.clientName, siteRows: null, submitted: invoiceCount > 0, invoiceCount };
      }

      const wholeProjectCovered = monthInvoices.some((inv) => {
        if (!inv.siteId) return true; // Manual Invoice — tied to the project, not a specific site.
        const covered = new Set(getInvoiceSiteAllocations(inv).map((a) => a.siteId).filter(Boolean));
        return sites.every((s) => covered.has(s.id));
      });
      if (wholeProjectCovered) {
        return { tenderId: project.id, projectName: project.clientName, siteRows: null, submitted: true, invoiceCount };
      }

      const siteRows: ChecklistSiteRow[] = sites.map((site) => {
        const matching = monthInvoices.filter((inv) => getInvoiceSiteAllocations(inv).some((a) => a.siteId === site.id));
        return { siteId: site.id, siteName: site.name, submitted: matching.length > 0, invoiceCount: matching.length };
      });
      return {
        tenderId: project.id,
        projectName: project.clientName,
        siteRows,
        submitted: siteRows.every((r) => r.submitted),
        invoiceCount,
      };
    });

    // Not-yet-fully-submitted projects first — the actionable ones — then alphabetically within
    // each group.
    return rows.sort((a, b) => {
      if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
      return a.projectName.localeCompare(b.projectName);
    });
  }, [activeProjectsForChecklist, filtered, sitesByTender, checklistMonth]);

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
                <th className="py-2 pr-4 font-medium">{t('branchCollection.revenuePanel.colContractStart')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colInvoices')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colRevenueRM')}</th>
                <th className="py-2 font-medium text-right">{t('branchCollection.revenuePanel.colPercentOfTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {bySite.map((row) => {
                const tender = row.tenderId ? tenderById.get(row.tenderId) : undefined;
                return (
                  <tr key={row.siteId || row.tenderId || row.siteName} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <span>{row.siteName}</span>
                        {tender && (
                          <button
                            onClick={() => setDetailsTender(tender)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-700"
                          >
                            {t('branchCollection.revenuePanel.viewDetails')}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{tender?.contractStart ? formatDate(tender.contractStart) : '—'}</td>
                    <td className="py-2 pr-4 text-right">{row.invoiceCount}</td>
                    <td className="py-2 pr-4 text-right font-medium">{row.revenue.toFixed(2)}</td>
                    <td className="py-2 text-right text-slate-500">
                      {overall.revenue > 0 ? `${((row.revenue / overall.revenue) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
              {bySite.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-xs text-slate-400">
                    {t('branchCollection.revenuePanel.noneMatchFilters')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
          <h3 className="text-sm font-semibold text-slate-800">{t('branchCollection.revenuePanel.invoiceChecklist')}</h3>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            {t('branchCollection.revenuePanel.checklistMonthLabel')}
            <input
              type="month"
              value={checklistMonth}
              onChange={(e) => setChecklistMonth(e.target.value || currentMonthKey())}
              className="input text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">{t('branchCollection.revenuePanel.invoiceChecklistDesc')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-4 font-medium">{t('branchCollection.revenuePanel.colProjectSite')}</th>
                <th className="py-2 pr-4 font-medium text-right">{t('branchCollection.revenuePanel.colInvoices')}</th>
                <th className="py-2 font-medium text-right">{t('branchCollection.revenuePanel.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {invoiceChecklist.map((row) => (
                <Fragment key={row.tenderId}>
                  {row.siteRows ? (
                    <>
                      <tr className="border-b border-slate-50">
                        <td colSpan={3} className="pt-2.5 pb-1 pr-4 text-xs font-semibold text-slate-500">
                          {row.projectName}
                        </td>
                      </tr>
                      {row.siteRows.map((site) => (
                        <tr key={site.siteId} className="border-b border-slate-50 last:border-0">
                          <td className="py-2 pr-4 pl-4 text-slate-600">{site.siteName}</td>
                          <td className="py-2 pr-4 text-right">{site.invoiceCount}</td>
                          <td className="py-2 text-right">
                            <span className={site.submitted ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-amber-700'}>
                              {site.submitted
                                ? t('branchCollection.revenuePanel.statusSubmitted')
                                : t('branchCollection.revenuePanel.statusNotSubmitted')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <tr className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-4">{row.projectName}</td>
                      <td className="py-2 pr-4 text-right">{row.invoiceCount}</td>
                      <td className="py-2 text-right">
                        <span className={row.submitted ? 'text-xs font-medium text-emerald-700' : 'text-xs font-medium text-amber-700'}>
                          {row.submitted
                            ? t('branchCollection.revenuePanel.statusSubmitted')
                            : t('branchCollection.revenuePanel.statusNotSubmitted')}
                        </span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {invoiceChecklist.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-xs text-slate-400">
                    {t('branchCollection.revenuePanel.noActiveProjects')}
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

      {profile && (
        <ProjectDetailsModal
          open={detailsTender !== null}
          tender={detailsTender}
          onClose={() => setDetailsTender(null)}
          liveGuardCount={detailsTender ? liveGuardCounts.get(detailsTender.id) : undefined}
          actor={{ uid: profile.uid, name: profile.name, role: profile.role }}
        />
      )}
    </div>
  );
}
