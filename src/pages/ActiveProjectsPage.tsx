import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useLiveGuardCountsByTender, useWonTenders } from '../hooks/useActiveProjects';
import { useBranches, useBrands } from '../hooks/useBranches';
import { useTenderHistory } from '../hooks/useTenderHistory';
import {
  acceptReassignment,
  assignFirstActiveBranch,
  backfillActiveBranch,
  cancelReassignment,
  closeOutProject,
  requestReassignBranch,
} from '../services/tenders';
import RenewContractModal from '../components/active-projects/RenewContractModal';
import { formatDate, formatRM } from '../utils/format';
import HeaderCollapseToggle from '../components/layout/HeaderCollapseToggle';
import {
  activeProjectBridgePeriods,
  activeProjectValueBridge,
  buildActiveProjectRaceFrames,
  estimatedMonthlyCollectionForYear,
  BRIDGE_TIME_VIEWS,
  type ActiveProjectRaceMetric,
  type BridgeTimeView,
  type RaceTimeView,
} from '../utils/analytics';
import StatCard from '../components/analytics/StatCard';
import ProjectDetailsModal from '../components/active-projects/ProjectDetailsModal';
import { BrandBreakdown } from '../components/active-projects/ActiveProjectBreakdown';
import WaterfallChart from '../components/analytics/WaterfallChart';
import RaceBarChart from '../components/analytics/RaceBarChart';
import { VIZ } from '../utils/vizColors';
import type { Tender } from '../types';
import { isAdminRole } from '../types';

const ENDING_SOON_DAYS = 60;
// A tighter, more urgent slice of ENDING_SOON_DAYS above — its own stat tile so a branch
// manager can tell "needs attention eventually" (60 days) apart from "needs attention now"
// (30 days) at a glance, without having to open the list and start counting badges.
const ENDING_VERY_SOON_DAYS = 30;

/** Whole days from today to an ISO contract-end date (negative once it's passed). */
function daysUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  const end = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
}

function ContractStatusBadge({ contractEnd }: { contractEnd: string }) {
  const { t } = useTranslation();
  const days = daysUntil(contractEnd);
  if (days === null) {
    return <span className="text-xs text-slate-400">{t('activeProjects.noEndDate')}</span>;
  }
  if (days < 0) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: `${VIZ.status.critical}1a`, color: VIZ.status.critical }}
      >
        {t('activeProjects.contractEndedBadge')}
      </span>
    );
  }
  if (days <= ENDING_SOON_DAYS) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: `${VIZ.status.warning}26`, color: '#9a6400' }}
      >
        {t('activeProjects.endingInDays', { days })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
      {t('activeProjects.active')}
    </span>
  );
}

export default function ActiveProjectsPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { wonTenders: rawWonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const isBranchManager = profile?.role === 'branchManager';

  // This branch's own tenderIds (own activeBranch, still open) — passed to
  // useLiveGuardCountsByTender() below so it can ALSO pick up a site that's still linked to one
  // of these projects but has been delegated to a DIFFERENT branch to run (see
  // ProjectDetailsModal.tsx's "Managing Branch" picker); its own `branch` field no longer
  // matches this one, so the hook's plain branch-scoped queries alone would silently miss it.
  // Computed from rawWonTenders (not the liveCount-overlaid `wonTenders` below) to avoid a
  // circular dependency on liveGuardCounts itself.
  const ownedTenderIds = useMemo(
    () => rawWonTenders.filter((tender) => !tender.closedOut && tender.activeBranch === profile?.department).map((tender) => tender.id),
    [rawWonTenders, profile?.department]
  );
  // Overlays each tender's guardsDeployed with the Duty Roster site's own live active-guard
  // count where one exists (see useLiveGuardCountsByTender's doc comment) — done once, up front,
  // so every downstream computation below (totals, the per-row list, the brand breakdown, the
  // race/bridge charts) automatically reflects the roster's real headcount without each of them
  // needing to know about sites at all. A tender with no live site yet (or a closed-out one whose
  // site was archived) keeps its manually-typed guardsDeployed untouched.
  const liveGuardCounts = useLiveGuardCountsByTender(profile, seesAllBranches, ownedTenderIds);
  const wonTenders = useMemo(
    () =>
      rawWonTenders.map((tender) => {
        const liveCount = liveGuardCounts.get(tender.id);
        return liveCount === undefined ? tender : { ...tender, guardsDeployed: liveCount };
      }),
    [rawWonTenders, liveGuardCounts]
  );

  // useWonTenders() merges in a second query for tenders pending reassignment TO this branch
  // (see its own doc comment) — activeBranch on those still points at the OLD branch, so they're
  // deliberately excluded here rather than mixed into "my branch's active projects"; they only
  // ever appear in the separate pendingIncoming list below, until accepted.
  const projects = useMemo(
    () => wonTenders.filter((tender) => !tender.closedOut && (seesAllBranches || tender.activeBranch === profile?.department)),
    [wonTenders, seesAllBranches, profile?.department]
  );
  // Won tenders with a reassignment pending TO this Branch Manager's own branch, awaiting their
  // accept/choose decision (see Tender.pendingReassignment and the "pendingIncoming" banner
  // rendered below). Admin/HQ already see these as ordinary rows (their query has no
  // activeBranch filter to exclude them) with a "Pending" badge instead — this list is
  // specifically for the person who has to act on it.
  const pendingIncoming = useMemo(
    () =>
      isBranchManager
        ? wonTenders.filter(
            (tender) => !tender.closedOut && tender.pendingReassignment && tender.pendingReassignment.toBranch === profile?.department
          )
        : [],
    [wonTenders, isBranchManager, profile?.department]
  );
  const { branches } = useBranches();
  const { brands } = useBrands();
  const [branchFilter, setBranchFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [detailsTender, setDetailsTender] = useState<Tender | null>(null);
  const [renewingTender, setRenewingTender] = useState<Tender | null>(null);
  const [bridgeTimeView, setBridgeTimeView] = useState<BridgeTimeView>('monthly');
  const [bridgePeriodKey, setBridgePeriodKey] = useState<string | null>(null);
  const [raceTimeView, setRaceTimeView] = useState<RaceTimeView>('alltime');
  const [raceMetric, setRaceMetric] = useState<ActiveProjectRaceMetric>('value');
  // Which stat tile's "Go to list" was clicked, if any — narrows the project table further down
  // this same page to just the matching rows. 'none' shows everything, same as before these
  // actions existed. Deliberately keyed off `visible` (branch-filtered only, not this filter)
  // for the tile counts themselves — see reminderFiltered below — so the numbers stay meaningful
  // even while a reminder filter is already active.
  const [reminderFilter, setReminderFilter] = useState<'none' | 'endingSoon' | 'endingVerySoon' | 'contractEnded'>(
    'none'
  );

  const isAdmin = isAdminRole(profile?.role);
  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);

  // The "Value" / "Guards deployed" toggle for the Active Projects Race chart below — kept as
  // its own translated option list (rather than RaceBarChart's built-in won/submitted default)
  // since this race ranks by a different pair of metrics. See RaceBarChart's metricOptions prop.
  const activeRaceMetricOptions = useMemo(
    () => [
      { value: 'value' as ActiveProjectRaceMetric, label: t('activeProjects.raceMetricValue') },
      { value: 'guards' as ActiveProjectRaceMetric, label: t('activeProjects.raceMetricGuards') },
    ],
    [t]
  );

  // One-time-per-tender opportunistic backfill for Won tenders that predate Active Projects and
  // so are missing `activeBranch`. Restricted to admins: Firestore rules only let an admin update
  // a tender they don't personally own, so a non-admin HQ viewer running this against someone
  // else's tender would just hit permission-denied.
  useEffect(() => {
    if (!isAdmin) return;
    projects.forEach((tender) => {
      if (!tender.activeBranch) backfillActiveBranch(tender).catch(() => {});
    });
  }, [projects, isAdmin]);

  const visible = useMemo(() => {
    let rows = projects;
    if (seesAllBranches && branchFilter !== 'all') {
      rows = rows.filter((tender) => (tender.activeBranch || tender.department) === branchFilter);
    }
    if (brandFilter !== 'all') {
      rows = rows.filter((tender) => tender.brandId === brandFilter);
    }
    return rows;
  }, [projects, seesAllBranches, branchFilter, brandFilter]);

  // The value bridge needs every Won tender in scope — active AND already closed-out — so a
  // project that left this month still shows its exit; `visible` above is active-only. Filtered
  // by the same branch criterion as `visible` so the bridge matches whatever the branch dropdown
  // is currently showing. Starts from `wonTenders` scoped to this user's own branch (mirroring
  // `projects` above), not the raw merged list — a tender only pending reassignment TO this
  // branch isn't this branch's revenue yet and shouldn't show up in its bridge.
  const myBranchWonTenders = useMemo(
    () => (seesAllBranches ? wonTenders : wonTenders.filter((tender) => tender.activeBranch === profile?.department)),
    [wonTenders, seesAllBranches, profile?.department]
  );
  const bridgeSource = useMemo(() => {
    if (!seesAllBranches || branchFilter === 'all') return myBranchWonTenders;
    return myBranchWonTenders.filter((tender) => (tender.activeBranch || tender.department) === branchFilter);
  }, [myBranchWonTenders, seesAllBranches, branchFilter]);

  const bridgePeriods = useMemo(
    () => activeProjectBridgePeriods(bridgeSource, bridgeTimeView),
    [bridgeSource, bridgeTimeView]
  );
  const bridgeFoundIndex = bridgePeriodKey ? bridgePeriods.findIndex((p) => p.key === bridgePeriodKey) : -1;
  const bridgeIndex = bridgeFoundIndex >= 0 ? bridgeFoundIndex : bridgePeriods.length - 1;
  const currentBridgePeriod = bridgePeriods[bridgeIndex];
  // Scoped to every Won tender this viewer can see (not just `bridgeSource`, which narrows
  // further by the branch dropdown) so switching that dropdown never tears down and re-opens
  // history subscriptions — see useTenderHistory's own doc comment on why this is per-tender
  // subscriptions rather than one big collectionGroup query.
  const { entries: wonHistoryEntries } = useTenderHistory(wonTenders);
  const bridgeBars = useMemo(
    () =>
      currentBridgePeriod
        ? activeProjectValueBridge(bridgeSource, wonHistoryEntries, bridgeTimeView, currentBridgePeriod.key)
        : [],
    [bridgeSource, wonHistoryEntries, bridgeTimeView, currentBridgePeriod]
  );

  // Active Projects Race ranks branches only — HQ holds no active projects of its own — and,
  // like the by-brand table's own scoping, is intentionally NOT filtered by the branch dropdown
  // above: the whole point of a race is comparing every branch against each other.
  const activeRaceFrames = useMemo(
    () => buildActiveProjectRaceFrames(projects, branchNames, raceTimeView, raceMetric),
    [projects, branchNames, raceTimeView, raceMetric]
  );

  // Applies the reminder-tile filter (if any) on top of the branch filter already baked into
  // `visible`, for the table below — see reminderFilter's own doc comment above for why the tile
  // counts themselves are computed from `visible` directly, not this.
  const reminderFiltered = useMemo(() => {
    if (reminderFilter === 'none') return visible;
    return visible.filter((tender) => {
      const d = daysUntil(tender.contractEnd);
      if (d === null) return false;
      if (reminderFilter === 'contractEnded') return d < 0;
      if (reminderFilter === 'endingVerySoon') return d >= 0 && d <= ENDING_VERY_SOON_DAYS;
      return d >= 0 && d <= ENDING_SOON_DAYS;
    });
  }, [visible, reminderFilter]);

  const sorted = useMemo(
    () =>
      [...reminderFiltered].sort((a, b) => {
        const daysA = daysUntil(a.contractEnd);
        const daysB = daysUntil(b.contractEnd);
        if (daysA === null) return 1;
        if (daysB === null) return -1;
        return daysA - daysB;
      }),
    [reminderFiltered]
  );

  const totalValue = visible.reduce((sum, tender) => sum + (tender.tenderValue || 0), 0);
  const endingSoonCount = visible.filter((tender) => {
    const d = daysUntil(tender.contractEnd);
    return d !== null && d >= 0 && d <= ENDING_SOON_DAYS;
  }).length;
  // Subset of endingSoonCount above (0-30 days is inside 0-60 days) — deliberately excludes
  // already-passed contracts the same way endingSoonCount does, since those are their own
  // "Contract Ended" tile below, not a more-urgent flavor of "ending soon".
  const endingVerySoonCount = visible.filter((tender) => {
    const d = daysUntil(tender.contractEnd);
    return d !== null && d >= 0 && d <= ENDING_VERY_SOON_DAYS;
  }).length;
  const endedCount = visible.filter((tender) => {
    const d = daysUntil(tender.contractEnd);
    return d !== null && d < 0;
  }).length;
  const totalGuards = visible.reduce((sum, tender) => sum + (tender.guardsDeployed || 0), 0);

  // "Estimated monthly collection" tiles: each visible project's tenderValue spread evenly over
  // its own contract length, then prorated by how many of that year's 12 months the contract
  // actually covers (see estimatedMonthlyCollectionForYear's doc comment), summed across every
  // project whose contract touches this year / next year. Recomputed from `visible` so it
  // reflects the branch + brand filters currently applied to the list below, same as every other
  // tile in this row.
  const thisYear = new Date().getFullYear();
  const currentYearMonthlyCollection = useMemo(
    () => estimatedMonthlyCollectionForYear(visible, thisYear),
    [visible, thisYear]
  );
  const nextYearMonthlyCollection = useMemo(
    () => estimatedMonthlyCollectionForYear(visible, thisYear + 1),
    [visible, thisYear]
  );

  const brandScopeLabel = !seesAllBranches
    ? profile?.department || ''
    : branchFilter === 'all'
      ? t('activeProjects.allBranchesScope')
      : branchFilter;

  // Sets the reminder filter AND scrolls the (possibly far-below-the-fold) project table into
  // view, so "Go to list" actually feels like it went somewhere rather than just changing a
  // number above the fold nobody's looking at.
  const goToReminderList = (filter: 'endingSoon' | 'endingVerySoon' | 'contractEnded') => {
    setReminderFilter(filter);
    document.getElementById('activeProjectsList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleBranchChange = (tender: Tender, newBranch: string) => {
    const current = tender.activeBranch;
    if (newBranch === current) return;
    if (!current) {
      // First-ever assignment — uncontested (no receiving manager needs to accept), but a
      // Duty Roster site can already exist for this project (see assignFirstActiveBranch()'s
      // doc comment) so this still needs to sweep it over, not just flip activeBranch.
      const confirmed = window.confirm(t('activeProjects.confirmAssign', { client: tender.clientName, branch: newBranch }));
      if (!confirmed) return;
      assignFirstActiveBranch(tender, newBranch);
      return;
    }
    const confirmed = window.confirm(
      t('activeProjects.confirmReassignRequest', { client: tender.clientName, from: current, to: newBranch })
    );
    if (!confirmed) return;
    requestReassignBranch(tender.id, newBranch, current);
  };

  const handleCancelReassignment = (tender: Tender) => {
    if (!tender.pendingReassignment) return;
    const confirmed = window.confirm(
      t('activeProjects.confirmCancelReassignment', { client: tender.clientName, branch: tender.pendingReassignment.toBranch })
    );
    if (!confirmed) return;
    cancelReassignment(tender.id);
  };

  const handleAcceptReassignment = (tender: Tender, choice: 'bring-over' | 'new') => {
    if (!tender.pendingReassignment) return;
    const toBranch = tender.pendingReassignment.toBranch;
    const confirmed =
      choice === 'bring-over'
        ? window.confirm(t('activeProjects.confirmBringOver', { client: tender.clientName, branch: toBranch }))
        : window.confirm(t('activeProjects.confirmNewRoster', { client: tender.clientName, branch: toBranch }));
    if (!confirmed) return;
    acceptReassignment(tender.id, tender.activeBranch || tender.department || null, toBranch, choice);
  };

  const handleCloseOut = (tender: Tender) => {
    const confirmed = window.confirm(t('activeProjects.confirmCloseOut', { client: tender.clientName }));
    if (!confirmed) return;
    closeOutProject(tender.id);
  };

  if (!profile) return null;

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{t('activeProjects.title')}</h1>
          <HeaderCollapseToggle expanded={headerExpanded} onToggle={() => setHeaderExpanded((v) => !v)} />
        </div>
        {headerExpanded && (
          <div className="flex items-center justify-between gap-4 flex-wrap mt-2">
            <p className="text-sm text-slate-500">
              {seesAllBranches
                ? t('activeProjects.subtitleAll')
                : t('activeProjects.subtitleBranch', { department: profile.department })}
            </p>
            <div className="flex items-center gap-2">
              <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-full sm:w-40">
                <option value="all">{t('activeProjects.allBrands')}</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {seesAllBranches && (
                <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-full sm:w-44">
                  <option value="all">{t('activeProjects.allBranches')}</option>
                  {branchNames.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">{t('activeProjects.loading')}</p>
      ) : (
        <div className="px-6 py-6 space-y-6 max-w-6xl">
          {pendingIncoming.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-900">
                {pendingIncoming.length === 1
                  ? t('activeProjects.pendingSingular')
                  : t('activeProjects.pendingPlural', { count: pendingIncoming.length })}
              </h3>
              {pendingIncoming.map((tender) => (
                <div
                  key={tender.id}
                  className="flex items-center justify-between gap-4 bg-white rounded-lg border border-amber-100 px-4 py-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{tender.clientName}</p>
                    <p className="text-xs text-slate-500">
                      {t('activeProjects.pendingReassignBody', {
                        from: tender.pendingReassignment?.fromBranch || t('activeProjects.unassigned'),
                        department: profile.department,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAcceptReassignment(tender, 'bring-over')}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                    >
                      {t('activeProjects.bringOverRoster')}
                    </button>
                    <button
                      onClick={() => handleAcceptReassignment(tender, 'new')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                    >
                      {t('activeProjects.startNewRoster')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stays at 4 columns through xl (1280px) rather than jumping to all 7 there — packing
              7 tiles that tight is what was squeezing the RM-value tiles into wrapping mid-number
              (see valueSizeClass()'s doc comment in StatCard.tsx for the other half of that fix).
              Only widens to the full 7-across row at 2xl (1536px+), where there's room for it. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-4">
            <StatCard
              label={t('activeProjects.activeProjectValue')}
              value={formatRM(totalValue)}
              sub={t('activeProjects.activeProjectsCount', { count: visible.length })}
              accent={VIZ.status.good}
            />
            <StatCard
              label={t('activeProjects.estMonthlyCollection', { year: thisYear })}
              value={formatRM(currentYearMonthlyCollection)}
              sub={t('activeProjects.estMonthlyCollectionSub')}
            />
            <StatCard
              label={t('activeProjects.estMonthlyCollection', { year: thisYear + 1 })}
              value={formatRM(nextYearMonthlyCollection)}
              sub={t('activeProjects.estMonthlyCollectionSub')}
            />
            <StatCard
              label={t('activeProjects.endingSoon')}
              value={String(endingSoonCount)}
              sub={t('activeProjects.withinDays', { days: ENDING_SOON_DAYS })}
              accent={VIZ.status.warning}
              action={{
                label: t('activeProjects.goToList'),
                onClick: () => goToReminderList('endingSoon'),
                disabled: endingSoonCount === 0,
              }}
            />
            <StatCard
              label={t('activeProjects.endingVerySoon')}
              value={String(endingVerySoonCount)}
              sub={t('activeProjects.withinDays', { days: ENDING_VERY_SOON_DAYS })}
              accent={VIZ.status.critical}
              action={{
                label: t('activeProjects.goToList'),
                onClick: () => goToReminderList('endingVerySoon'),
                disabled: endingVerySoonCount === 0,
              }}
            />
            <StatCard
              label={t('activeProjects.contractEnded')}
              value={String(endedCount)}
              sub={t('activeProjects.needsFollowUp')}
              accent={VIZ.status.critical}
              action={{
                label: t('activeProjects.goToList'),
                onClick: () => goToReminderList('contractEnded'),
                disabled: endedCount === 0,
              }}
            />
            <StatCard
              label={t('activeProjects.guardsDeployed')}
              value={String(totalGuards)}
              sub={t('activeProjects.acrossShownProjects')}
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-800">{t('activeProjects.bridgeTitle')}</h3>
              {bridgePeriods.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setBridgePeriodKey(bridgePeriods[Math.max(bridgeIndex - 1, 0)].key)}
                    disabled={bridgeIndex === 0}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30"
                  >
                    {t('charts.prev')}
                  </button>
                  <span className="text-xs font-semibold text-slate-700 w-28 text-center">
                    {currentBridgePeriod?.label}
                  </span>
                  <button
                    onClick={() =>
                      setBridgePeriodKey(bridgePeriods[Math.min(bridgeIndex + 1, bridgePeriods.length - 1)].key)
                    }
                    disabled={bridgeIndex >= bridgePeriods.length - 1}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30"
                  >
                    {t('charts.next')}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-4">
              {BRIDGE_TIME_VIEWS.map((tv) => (
                <button
                  key={tv.value}
                  onClick={() => {
                    setBridgeTimeView(tv.value);
                    setBridgePeriodKey(null);
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                    bridgeTimeView === tv.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t(tv.label)}
                </button>
              ))}
            </div>
            <WaterfallChart bars={bridgeBars} />
          </div>

          <BrandBreakdown items={visible} scopeLabel={brandScopeLabel} />

          {isAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                {raceMetric === 'guards' ? t('activeProjects.raceTitleGuards') : t('activeProjects.raceTitleValue')}
              </h3>
              <RaceBarChart
                frames={activeRaceFrames}
                metric={raceMetric}
                timeView={raceTimeView}
                onMetricChange={setRaceMetric}
                onTimeViewChange={setRaceTimeView}
                colorDomain={branchNames}
                metricOptions={activeRaceMetricOptions}
                valueFormatter={raceMetric === 'guards' ? (v) => String(v) : formatRM}
              />
            </div>
          )}

          <div id="activeProjectsList" />

          {reminderFilter !== 'none' && (
            <div className="flex items-center justify-between gap-3 bg-amber-50 text-amber-800 text-sm rounded-lg px-3 py-2">
              <span>
                {t('activeProjects.showingFilter')}{' '}
                <span className="font-medium">
                  {reminderFilter === 'endingSoon'
                    ? t('activeProjects.endingSoon')
                    : reminderFilter === 'endingVerySoon'
                      ? t('activeProjects.endingVerySoon')
                      : t('activeProjects.contractEnded')}
                </span>{' '}
                ({sorted.length})
              </span>
              <button
                onClick={() => setReminderFilter('none')}
                className="font-medium underline underline-offset-2 shrink-0"
              >
                {t('activeProjects.clearFilter')}
              </button>
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              {reminderFilter === 'none' ? t('activeProjects.noProjectsYet') : t('activeProjects.noProjectsMatchFilter')}
            </p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">{t('activeProjects.table.client')}</th>
                    <th className="px-4 py-3">{t('activeProjects.table.brand')}</th>
                    {seesAllBranches && <th className="px-4 py-3">{t('activeProjects.table.branch')}</th>}
                    <th className="px-4 py-3">{t('activeProjects.table.contractStart')}</th>
                    <th className="px-4 py-3">{t('activeProjects.table.contractEnd')}</th>
                    <th className="px-4 py-3">{t('activeProjects.table.status')}</th>
                    <th className="px-4 py-3 text-right">{t('activeProjects.table.value')}</th>
                    <th className="px-4 py-3">{t('activeProjects.table.details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((tender) => {
                    const hasDetails = tender.location || tender.contactPerson || tender.guardsDeployed != null || tender.tenderDocNumber || tender.scopeOfWork;
                    return (
                      <tr key={tender.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{tender.clientName}</p>
                          {(tender.location || tender.guardsDeployed != null) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {tender.location && <>📍 {tender.location}</>}
                              {tender.location && tender.guardsDeployed != null && ' · '}
                              {tender.guardsDeployed != null && t('activeProjects.guardsCount', { count: tender.guardsDeployed })}
                            </p>
                          )}
                          {/* Non-privileged branch view has no Branch column at all (see
                              `seesAllBranches` below), so this is the only place the FROM branch
                              sees that a reassignment is in flight — they keep full access until
                              it's accepted (see requestReassignBranch()'s doc comment). */}
                          {!seesAllBranches && tender.pendingReassignment && (
                            <p className="text-[11px] font-medium text-amber-600 mt-0.5">
                              {t('activeProjects.pendingReassignmentTo', { branch: tender.pendingReassignment.toBranch })}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{tender.brandName}</td>
                        {seesAllBranches && (
                          <td className="px-4 py-3">
                            {tender.pendingReassignment ? (
                              <div className="space-y-0.5">
                                <span className="text-slate-500">{tender.activeBranch || t('activeProjects.unassigned')}</span>
                                <p className="text-[11px] font-medium text-amber-600">
                                  {t('activeProjects.pendingTo', { branch: tender.pendingReassignment.toBranch })}
                                  {isAdmin && (
                                    <>
                                      {' · '}
                                      <button
                                        onClick={() => handleCancelReassignment(tender)}
                                        className="underline hover:text-amber-800"
                                      >
                                        {t('activeProjects.cancel')}
                                      </button>
                                    </>
                                  )}
                                </p>
                              </div>
                            ) : isAdmin ? (
                              <select
                                value={tender.activeBranch || ''}
                                onChange={(e) => handleBranchChange(tender, e.target.value)}
                                className={
                                  tender.activeBranch
                                    ? 'input w-36 text-xs py-1'
                                    : 'input w-36 text-xs py-1 border-amber-300 text-amber-700'
                                }
                              >
                                <option value="" disabled>
                                  {t('activeProjects.selectBranch')}
                                </option>
                                {branchNames.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-500">{tender.activeBranch || t('activeProjects.unassigned')}</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-slate-500">{formatDate(tender.contractStart)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(tender.contractEnd)}</td>
                        <td className="px-4 py-3">
                          <ContractStatusBadge contractEnd={tender.contractEnd} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          {formatRM(tender.tenderValue)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => setDetailsTender(tender)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {hasDetails ? t('activeProjects.edit') : t('activeProjects.addDetails')}
                            </button>
                            <span className="text-slate-300">·</span>
                            {/* Duty Roster auto-creates-or-selects the one site tied to this
                                tender (see DutyRosterPage.tsx and index.html's bootstrap code) —
                                this is the only way branch users reach a project's roster now;
                                there's no more manual "New site" for them to use instead. */}
                            <Link
                              to={`/duty-roster?tenderId=${encodeURIComponent(tender.id)}&clientName=${encodeURIComponent(tender.clientName)}&branch=${encodeURIComponent(tender.activeBranch || tender.department)}`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {t('activeProjects.dutyRoster')}
                            </Link>
                            <span className="text-slate-300">·</span>
                            {/* Visible on every row here because it always is one: `projects`
                                (this table's source list) is already scoped to exactly the same
                                audience firestore.rules grants contractEnd/tenderValue write
                                access to for a Won tender — admin/HQ see every row, everyone
                                else only their own activeBranch's — see renewContract()'s doc
                                comment in services/tenders.ts. */}
                            <button
                              onClick={() => setRenewingTender(tender)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {t('activeProjects.renew')}
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                              onClick={() => handleCloseOut(tender)}
                              className="text-xs font-medium text-slate-500 hover:text-rose-600"
                            >
                              {t('activeProjects.closeOut')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ProjectDetailsModal
        open={detailsTender !== null}
        tender={detailsTender}
        onClose={() => setDetailsTender(null)}
        liveGuardCount={detailsTender ? liveGuardCounts.get(detailsTender.id) : undefined}
        actor={{ uid: profile.uid, name: profile.name, role: profile.role }}
      />

      {profile && (
        <RenewContractModal
          open={renewingTender !== null}
          tender={renewingTender}
          onClose={() => setRenewingTender(null)}
          actor={{ uid: profile.uid, name: profile.name, role: profile.role }}
        />
      )}
    </div>
  );
}
