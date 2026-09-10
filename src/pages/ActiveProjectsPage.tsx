import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useWonTenders } from '../hooks/useActiveProjects';
import { useBranches } from '../hooks/useBranches';
import {
  acceptReassignment,
  backfillActiveBranch,
  cancelReassignment,
  closeOutProject,
  requestReassignBranch,
  setActiveBranch,
} from '../services/tenders';
import { formatDate, formatRM } from '../utils/format';
import {
  activeProjectBridgePeriods,
  activeProjectValueBridge,
  buildActiveProjectRaceFrames,
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

const ENDING_SOON_DAYS = 60;

const ACTIVE_RACE_METRICS = [
  { value: 'value' as ActiveProjectRaceMetric, label: 'Value' },
  { value: 'guards' as ActiveProjectRaceMetric, label: 'Guards deployed' },
];

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
  const days = daysUntil(contractEnd);
  if (days === null) {
    return <span className="text-xs text-slate-400">No end date</span>;
  }
  if (days < 0) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: `${VIZ.status.critical}1a`, color: VIZ.status.critical }}
      >
        Contract ended
      </span>
    );
  }
  if (days <= ENDING_SOON_DAYS) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
        style={{ backgroundColor: `${VIZ.status.warning}26`, color: '#9a6400' }}
      >
        Ending in {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500">
      Active
    </span>
  );
}

export default function ActiveProjectsPage() {
  const { profile } = useAuth();
  const { wonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const isBranchManager = profile?.role === 'branchManager';

  // useWonTenders() merges in a second query for tenders pending reassignment TO this branch
  // (see its own doc comment) — activeBranch on those still points at the OLD branch, so they're
  // deliberately excluded here rather than mixed into "my branch's active projects"; they only
  // ever appear in the separate pendingIncoming list below, until accepted.
  const projects = useMemo(
    () => wonTenders.filter((t) => !t.closedOut && (seesAllBranches || t.activeBranch === profile?.department)),
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
            (t) => !t.closedOut && t.pendingReassignment && t.pendingReassignment.toBranch === profile?.department
          )
        : [],
    [wonTenders, isBranchManager, profile?.department]
  );
  const { branches } = useBranches();
  const [branchFilter, setBranchFilter] = useState('all');
  const [detailsTender, setDetailsTender] = useState<Tender | null>(null);
  const [bridgeTimeView, setBridgeTimeView] = useState<BridgeTimeView>('monthly');
  const [bridgePeriodKey, setBridgePeriodKey] = useState<string | null>(null);
  const [raceTimeView, setRaceTimeView] = useState<RaceTimeView>('alltime');
  const [raceMetric, setRaceMetric] = useState<ActiveProjectRaceMetric>('value');

  const isAdmin = profile?.role === 'admin';
  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);

  // One-time-per-tender opportunistic backfill for Won tenders that predate Active Projects and
  // so are missing `activeBranch`. Restricted to admins: Firestore rules only let an admin update
  // a tender they don't personally own, so a non-admin HQ viewer running this against someone
  // else's tender would just hit permission-denied.
  useEffect(() => {
    if (!isAdmin) return;
    projects.forEach((t) => {
      if (!t.activeBranch) backfillActiveBranch(t).catch(() => {});
    });
  }, [projects, isAdmin]);

  const visible = useMemo(() => {
    if (!seesAllBranches || branchFilter === 'all') return projects;
    return projects.filter((t) => (t.activeBranch || t.department) === branchFilter);
  }, [projects, seesAllBranches, branchFilter]);

  // The value bridge needs every Won tender in scope — active AND already closed-out — so a
  // project that left this month still shows its exit; `visible` above is active-only. Filtered
  // by the same branch criterion as `visible` so the bridge matches whatever the branch dropdown
  // is currently showing. Starts from `wonTenders` scoped to this user's own branch (mirroring
  // `projects` above), not the raw merged list — a tender only pending reassignment TO this
  // branch isn't this branch's revenue yet and shouldn't show up in its bridge.
  const myBranchWonTenders = useMemo(
    () => (seesAllBranches ? wonTenders : wonTenders.filter((t) => t.activeBranch === profile?.department)),
    [wonTenders, seesAllBranches, profile?.department]
  );
  const bridgeSource = useMemo(() => {
    if (!seesAllBranches || branchFilter === 'all') return myBranchWonTenders;
    return myBranchWonTenders.filter((t) => (t.activeBranch || t.department) === branchFilter);
  }, [myBranchWonTenders, seesAllBranches, branchFilter]);

  const bridgePeriods = useMemo(
    () => activeProjectBridgePeriods(bridgeSource, bridgeTimeView),
    [bridgeSource, bridgeTimeView]
  );
  const bridgeFoundIndex = bridgePeriodKey ? bridgePeriods.findIndex((p) => p.key === bridgePeriodKey) : -1;
  const bridgeIndex = bridgeFoundIndex >= 0 ? bridgeFoundIndex : bridgePeriods.length - 1;
  const currentBridgePeriod = bridgePeriods[bridgeIndex];
  const bridgeBars = useMemo(
    () =>
      currentBridgePeriod
        ? activeProjectValueBridge(bridgeSource, bridgeTimeView, currentBridgePeriod.key)
        : [],
    [bridgeSource, bridgeTimeView, currentBridgePeriod]
  );

  // Active Projects Race ranks branches only — HQ holds no active projects of its own — and,
  // like the by-brand table's own scoping, is intentionally NOT filtered by the branch dropdown
  // above: the whole point of a race is comparing every branch against each other.
  const activeRaceFrames = useMemo(
    () => buildActiveProjectRaceFrames(projects, branchNames, raceTimeView, raceMetric),
    [projects, branchNames, raceTimeView, raceMetric]
  );

  const sorted = useMemo(
    () =>
      [...visible].sort((a, b) => {
        const daysA = daysUntil(a.contractEnd);
        const daysB = daysUntil(b.contractEnd);
        if (daysA === null) return 1;
        if (daysB === null) return -1;
        return daysA - daysB;
      }),
    [visible]
  );

  const totalValue = visible.reduce((sum, t) => sum + (t.tenderValue || 0), 0);
  const endingSoonCount = visible.filter((t) => {
    const d = daysUntil(t.contractEnd);
    return d !== null && d >= 0 && d <= ENDING_SOON_DAYS;
  }).length;
  const endedCount = visible.filter((t) => {
    const d = daysUntil(t.contractEnd);
    return d !== null && d < 0;
  }).length;
  const totalGuards = visible.reduce((sum, t) => sum + (t.guardsDeployed || 0), 0);

  const brandScopeLabel = !seesAllBranches
    ? profile?.department || ''
    : branchFilter === 'all'
      ? 'all branches'
      : branchFilter;

  const handleBranchChange = (t: Tender, newBranch: string) => {
    const current = t.activeBranch;
    if (newBranch === current) return;
    if (!current) {
      // First-ever assignment — nothing exists yet under a different branch for a receiving
      // manager to protect or choose about, so this stays instant (see setActiveBranch()'s doc
      // comment).
      const confirmed = window.confirm(`Assign "${t.clientName}" to ${newBranch}'s Active Projects?`);
      if (!confirmed) return;
      setActiveBranch(t.id, newBranch);
      return;
    }
    const confirmed = window.confirm(
      `Request reassigning "${t.clientName}" from ${current} to ${newBranch}?\n\n` +
        `${current} keeps full access and its Duty Roster stays live until ${newBranch}'s Branch ` +
        `Manager accepts the move and chooses what happens to the existing duty roster.`
    );
    if (!confirmed) return;
    requestReassignBranch(t.id, newBranch, current);
  };

  const handleCancelReassignment = (t: Tender) => {
    if (!t.pendingReassignment) return;
    const confirmed = window.confirm(
      `Cancel the pending reassignment of "${t.clientName}" to ${t.pendingReassignment.toBranch}?`
    );
    if (!confirmed) return;
    cancelReassignment(t.id);
  };

  const handleAcceptReassignment = (t: Tender, choice: 'bring-over' | 'new') => {
    if (!t.pendingReassignment) return;
    const toBranch = t.pendingReassignment.toBranch;
    const confirmed =
      choice === 'bring-over'
        ? window.confirm(
            `Bring over "${t.clientName}"'s existing duty roster? Its guards, schedule and ` +
              `history all move to ${toBranch} as-is.`
          )
        : window.confirm(
            `Start a brand-new duty roster for "${t.clientName}" under ${toBranch}? The existing ` +
              `roster is archived (kept for Admin/HQ/Payroll records) but no longer used for this project.`
          );
    if (!confirmed) return;
    acceptReassignment(t.id, toBranch, choice);
  };

  const handleCloseOut = (t: Tender) => {
    const confirmed = window.confirm(
      `Close out "${t.clientName}"?\n\n` +
        `It will move out of Active Projects and into Past Projects. Its value keeps counting in ` +
        `Performance Analysis as Won revenue — this only affects the Active Projects view.`
    );
    if (!confirmed) return;
    closeOutProject(t.id);
  };

  if (!profile) return null;

  return (
    <div className="h-screen overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Active Projects</h1>
          <p className="text-sm text-slate-500">
            {seesAllBranches
              ? 'Won tenders currently running, across every branch'
              : `Won tenders currently running for ${profile.department}`}
          </p>
        </div>
        {seesAllBranches && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input w-44">
            <option value="all">All branches</option>
            {branchNames.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">Loading active projects…</p>
      ) : (
        <div className="px-6 py-6 space-y-6 max-w-6xl">
          {pendingIncoming.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-900">
                {pendingIncoming.length === 1
                  ? 'A project is being reassigned to your branch'
                  : `${pendingIncoming.length} projects are being reassigned to your branch`}
              </h3>
              {pendingIncoming.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-4 bg-white rounded-lg border border-amber-100 px-4 py-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{t.clientName}</p>
                    <p className="text-xs text-slate-500">
                      From {t.pendingReassignment?.fromBranch || 'Unassigned'} — choose what happens to its duty roster
                      before it goes live under {profile.department}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleAcceptReassignment(t, 'bring-over')}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                    >
                      Bring over existing roster
                    </button>
                    <button
                      onClick={() => handleAcceptReassignment(t, 'new')}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                    >
                      Start a new roster
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Active Project Value"
              value={formatRM(totalValue)}
              sub={`${visible.length} active project${visible.length === 1 ? '' : 's'}`}
              accent={VIZ.status.good}
            />
            <StatCard
              label="Ending Soon"
              value={String(endingSoonCount)}
              sub={`within ${ENDING_SOON_DAYS} days`}
              accent={VIZ.status.warning}
            />
            <StatCard
              label="Contract Ended"
              value={String(endedCount)}
              sub="needs follow-up"
              accent={VIZ.status.critical}
            />
            <StatCard label="Guards Deployed" value={String(totalGuards)} sub="across shown projects" />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-800">Active Project Value Bridge</h3>
              {bridgePeriods.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setBridgePeriodKey(bridgePeriods[Math.max(bridgeIndex - 1, 0)].key)}
                    disabled={bridgeIndex === 0}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30"
                  >
                    ◀ Prev
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
                    Next ▶
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
                  {tv.label}
                </button>
              ))}
            </div>
            <WaterfallChart bars={bridgeBars} />
          </div>

          <BrandBreakdown items={visible} scopeLabel={brandScopeLabel} />

          {isAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Active Projects Race — Branch {raceMetric === 'guards' ? 'Guards Deployed' : 'Value'} Over Time
              </h3>
              <RaceBarChart
                frames={activeRaceFrames}
                metric={raceMetric}
                timeView={raceTimeView}
                onMetricChange={setRaceMetric}
                onTimeViewChange={setRaceTimeView}
                colorDomain={branchNames}
                metricOptions={ACTIVE_RACE_METRICS}
                valueFormatter={raceMetric === 'guards' ? (v) => String(v) : formatRM}
              />
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No active projects yet.</p>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Brand</th>
                    {seesAllBranches && <th className="px-4 py-3">Branch</th>}
                    <th className="px-4 py-3">Contract Start</th>
                    <th className="px-4 py-3">Contract End</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Value</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const hasDetails = t.location || t.contactPerson || t.guardsDeployed != null || t.tenderDocNumber;
                    return (
                      <tr key={t.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{t.clientName}</p>
                          {(t.location || t.guardsDeployed != null) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.location && <>📍 {t.location}</>}
                              {t.location && t.guardsDeployed != null && ' · '}
                              {t.guardsDeployed != null && (
                                <>
                                  {t.guardsDeployed} guard{t.guardsDeployed === 1 ? '' : 's'}
                                </>
                              )}
                            </p>
                          )}
                          {/* Non-privileged branch view has no Branch column at all (see
                              `seesAllBranches` below), so this is the only place the FROM branch
                              sees that a reassignment is in flight — they keep full access until
                              it's accepted (see requestReassignBranch()'s doc comment). */}
                          {!seesAllBranches && t.pendingReassignment && (
                            <p className="text-[11px] font-medium text-amber-600 mt-0.5">
                              → pending reassignment to {t.pendingReassignment.toBranch}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{t.brandName}</td>
                        {seesAllBranches && (
                          <td className="px-4 py-3">
                            {t.pendingReassignment ? (
                              <div className="space-y-0.5">
                                <span className="text-slate-500">{t.activeBranch || 'Unassigned'}</span>
                                <p className="text-[11px] font-medium text-amber-600">
                                  → pending to {t.pendingReassignment.toBranch}
                                  {isAdmin && (
                                    <>
                                      {' · '}
                                      <button
                                        onClick={() => handleCancelReassignment(t)}
                                        className="underline hover:text-amber-800"
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  )}
                                </p>
                              </div>
                            ) : isAdmin ? (
                              <select
                                value={t.activeBranch || ''}
                                onChange={(e) => handleBranchChange(t, e.target.value)}
                                className={
                                  t.activeBranch
                                    ? 'input w-36 text-xs py-1'
                                    : 'input w-36 text-xs py-1 border-amber-300 text-amber-700'
                                }
                              >
                                <option value="" disabled>
                                  Select branch
                                </option>
                                {branchNames.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-slate-500">{t.activeBranch || 'Unassigned'}</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-slate-500">{formatDate(t.contractStart)}</td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(t.contractEnd)}</td>
                        <td className="px-4 py-3">
                          <ContractStatusBadge contractEnd={t.contractEnd} />
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">
                          {formatRM(t.tenderValue)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={() => setDetailsTender(t)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {hasDetails ? 'Edit' : '+ Add'}
                            </button>
                            <span className="text-slate-300">·</span>
                            {/* Duty Roster auto-creates-or-selects the one site tied to this
                                tender (see DutyRosterPage.tsx and index.html's bootstrap code) —
                                this is the only way branch users reach a project's roster now;
                                there's no more manual "New site" for them to use instead. */}
                            <Link
                              to={`/duty-roster?tenderId=${encodeURIComponent(t.id)}&clientName=${encodeURIComponent(t.clientName)}&branch=${encodeURIComponent(t.activeBranch || t.department)}`}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              Duty Roster
                            </Link>
                            <span className="text-slate-300">·</span>
                            <button
                              onClick={() => handleCloseOut(t)}
                              className="text-xs font-medium text-slate-500 hover:text-rose-600"
                            >
                              Close out
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
      />
    </div>
  );
}
