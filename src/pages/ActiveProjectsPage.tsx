import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useWonTenders } from '../hooks/useActiveProjects';
import { useBranches } from '../hooks/useBranches';
import { backfillActiveBranch, closeOutProject, setActiveBranch } from '../services/tenders';
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
  const projects = useMemo(() => wonTenders.filter((t) => !t.closedOut), [wonTenders]);
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
  // is currently showing.
  const bridgeSource = useMemo(() => {
    if (!seesAllBranches || branchFilter === 'all') return wonTenders;
    return wonTenders.filter((t) => (t.activeBranch || t.department) === branchFilter);
  }, [wonTenders, seesAllBranches, branchFilter]);

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
    const confirmed = current
      ? window.confirm(
          `Reassign "${t.clientName}" from ${current} to ${newBranch}?\n\n` +
            `It will move out of ${current}'s Active Projects list and into ${newBranch}'s.`
        )
      : window.confirm(`Assign "${t.clientName}" to ${newBranch}'s Active Projects?`);
    if (!confirmed) return;
    setActiveBranch(t.id, newBranch);
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
                        </td>
                        <td className="px-4 py-3 text-slate-500">{t.brandName}</td>
                        {seesAllBranches && (
                          <td className="px-4 py-3">
                            {isAdmin ? (
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
