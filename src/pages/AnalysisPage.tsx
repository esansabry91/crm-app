import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenders } from '../hooks/useTenders';
import { useTenderHistory } from '../hooks/useTenderHistory';
import { useActiveProjects } from '../hooks/useActiveProjects';
import { useBranches, useBrands } from '../hooks/useBranches';
import {
  brandBreakdown,
  buildActiveProjectRaceFrames,
  buildRaceFrames,
  pipelineSummary,
  pipelineValueTrend,
  stageBreakdown,
  staffPerformance,
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
  const { entries } = useTenderHistory(profile);
  const { projects: activeProjects } = useActiveProjects(profile);
  const { brands } = useBrands();
  const { branches } = useBranches();

  const [brandFilter, setBrandFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [raceMetric, setRaceMetric] = useState<RaceMetric>('won');
  const [raceTimeView, setRaceTimeView] = useState<RaceTimeView>('alltime');
  const [activeRaceTimeView, setActiveRaceTimeView] = useState<RaceTimeView>('alltime');

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

  // Active Projects race ranks branches only — HQ holds no active projects of its own, so it's
  // excluded from the field here (unlike raceDepartments above, which includes it).
  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);
  const activeRaceFrames = useMemo(
    () => buildActiveProjectRaceFrames(activeProjects, branchNames, activeRaceTimeView),
    [activeProjects, branchNames, activeRaceTimeView]
  );

  if (!profile) return null;

  return (
    <div className="h-screen overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Performance Analysis</h1>
          <p className="text-sm text-slate-500">
            {profile.role === 'admin' ? 'All branches · all staff' : 'Your tenders'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className="input w-40">
            <option value="all">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input w-40">
            <option value="all">All departments</option>
            {departmentOptions.map((d) => (
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

              <Card title="Active Projects Race — Branch Value Over Time">
                <RaceBarChart
                  frames={activeRaceFrames}
                  timeView={activeRaceTimeView}
                  onTimeViewChange={setActiveRaceTimeView}
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
