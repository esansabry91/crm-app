import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useTenderHistory } from '../hooks/useTenderHistory';
import { useBranches, useBrands } from '../hooks/useBranches';
import {
  brandBreakdown,
  buildRaceFrames,
  BRIDGE_TIME_VIEWS,
  pipelineBridgePeriods,
  pipelineSummary,
  pipelineValueBridge,
  pipelineValueTrend,
  stageBreakdown,
  staffPerformance,
  type BridgeTimeView,
  type RaceMetric,
  type RaceTimeView,
} from '../utils/analytics';
import { formatRM } from '../utils/format';
import StatCard from '../components/analytics/StatCard';
import PipelineTrendChart from '../components/analytics/PipelineTrendChart';
import StageBarChart from '../components/analytics/StageBarChart';
import WonLostBar from '../components/analytics/WonLostBar';
import PipelineVsWonChart from '../components/analytics/PipelineVsWonChart';
import BrandBreakdownSection from '../components/analytics/BrandBreakdownSection';
import StaffPerformanceSection from '../components/analytics/StaffPerformanceSection';
import RaceBarChart from '../components/analytics/RaceBarChart';
import WaterfallChart from '../components/analytics/WaterfallChart';
import { VIZ } from '../utils/vizColors';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function AnalysisPage() {
  const { profile } = useAuth();
  const { tenders, loading } = useTenders(profile);
  // Scoped to exactly the tenders this viewer can already see — see useTenderHistory's own doc
  // comment for why this reads per-tender rather than a single collectionGroup('history') query.
  const { entries } = useTenderHistory(tenders);
  const { brands } = useBrands();
  const { branches } = useBranches();

  const [brandFilter, setBrandFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [raceMetric, setRaceMetric] = useState<RaceMetric>('won');
  const [raceTimeView, setRaceTimeView] = useState<RaceTimeView>('alltime');
  const [bridgeTimeView, setBridgeTimeView] = useState<BridgeTimeView>('monthly');
  const [bridgePeriodKey, setBridgePeriodKey] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      tenders.filter((t) => {
        if (brandFilter !== 'all' && t.brandId !== brandFilter) return false;
        if (deptFilter !== 'all' && t.department !== deptFilter) return false;
        return true;
      }),
    [tenders, brandFilter, deptFilter]
  );

  const summary = useMemo(() => pipelineSummary(filtered), [filtered]);
  const stages = useMemo(() => stageBreakdown(filtered), [filtered]);
  const trend = useMemo(() => pipelineValueTrend(entries), [entries]);
  const brandRows = useMemo(() => brandBreakdown(filtered), [filtered]);
  const staffRows = useMemo(() => staffPerformance(filtered), [filtered]);

  const departmentOptions = ['HQ', ...branches.map((b) => b.name)];

  const raceDepartments = useMemo(() => {
    const set = new Set(departmentOptions);
    tenders.forEach((t) => {
      if (t.department) set.add(t.department);
    });
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenders, branches]);

  const raceFrames = useMemo(
    () => buildRaceFrames(filtered, raceDepartments, raceMetric, raceTimeView),
    [filtered, raceDepartments, raceMetric, raceTimeView]
  );

  const bridgePeriods = useMemo(() => pipelineBridgePeriods(entries, bridgeTimeView), [entries, bridgeTimeView]);
  const bridgeFoundIndex = bridgePeriodKey ? bridgePeriods.findIndex((p) => p.key === bridgePeriodKey) : -1;
  const bridgeIndex = bridgeFoundIndex >= 0 ? bridgeFoundIndex : bridgePeriods.length - 1;
  const currentBridgePeriod = bridgePeriods[bridgeIndex];
  const bridgeBars = useMemo(
    () => (currentBridgePeriod ? pipelineValueBridge(entries, bridgeTimeView, currentBridgePeriod.key) : []),
    [entries, bridgeTimeView, currentBridgePeriod]
  );

  if (!profile) return null;

  // A non-admin's own tenders only ever carry their own department (Department always follows
  // the tender's Owner — see TenderFormModal.tsx — and a Branch Manager can never own a tender
  // outside their own branch), so the full company-wide department list would just be a menu of
  // choices that all return the same data except one. Scope the header dropdown itself to just
  // their branch; departmentOptions above stays company-wide since it also feeds the admin-only
  // race chart's colorDomain further down.
  const deptFilterOptions = profile.role === 'admin' ? departmentOptions : [profile.department];

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Pipeline Analysis</h1>
          <p className="text-sm text-slate-500">
            {profile.role === 'admin' ? 'All branches · all staff' : 'Your tenders'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-full sm:w-40">
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input w-full sm:w-40">
            <option value="all">All departments</option>
            {deptFilterOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </header>

      {loading ? (
        <p className="px-6 py-8 text-sm text-slate-400">Loading analytics…</p>
      ) : (
        <div className="px-6 py-6 space-y-6 max-w-6xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Open Pipeline Value"
              value={formatRM(summary.openValue)}
              sub={`${summary.openCount} active tenders`}
              accent={VIZ.categorical.blue}
            />
            <StatCard
              label="Won Value"
              value={formatRM(summary.wonValue)}
              sub={`${summary.wonCount} tenders won`}
              accent={VIZ.status.good}
            />
            <StatCard
              label="Lost Value"
              value={formatRM(summary.lostValue)}
              sub={`${summary.lostCount} tenders lost`}
              accent={VIZ.status.critical}
            />
            <StatCard
              label="Win Rate"
              value={`${Math.round(summary.winRate * 100)}%`}
              sub="of closed tenders"
            />
          </div>

          <Card title="Total Pipeline Value Trend">
            <PipelineTrendChart data={trend} />
          </Card>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-800">Open Pipeline Value Bridge</h3>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Number of Tenders by Stage">
              <StageBarChart data={stages} metric="count" />
            </Card>
            <Card title="Pipeline Value by Stage (RM)">
              <StageBarChart data={stages} metric="value" />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Won vs Lost Tenders">
              <WonLostBar wonCount={summary.wonCount} lostCount={summary.lostCount} />
            </Card>
            <Card title="Total Pipeline Value vs Won Value">
              <PipelineVsWonChart openValue={summary.openValue} wonValue={summary.wonValue} />
            </Card>
          </div>

          <Card title="Performance by Brand">
            <BrandBreakdownSection rows={brandRows} />
          </Card>

          {profile.role === 'admin' && (
            <>
              <Card title="Tender Won/Submitted — Value Over Time">
                <RaceBarChart
                  frames={raceFrames}
                  metric={raceMetric}
                  timeView={raceTimeView}
                  onMetricChange={setRaceMetric}
                  onTimeViewChange={setRaceTimeView}
                  colorDomain={departmentOptions}
                />
              </Card>

              <Card title="Staff Performance">
                <StaffPerformanceSection rows={staffRows} />
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
