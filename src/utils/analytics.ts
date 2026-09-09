import { OPEN_STAGES, STAGES, type Stage, type Tender, type TenderHistoryEntry } from '../types';

export interface StageBreakdownRow {
  stage: Stage;
  count: number;
  value: number;
}

export function stageBreakdown(tenders: Tender[]): StageBreakdownRow[] {
  return STAGES.map((stage) => {
    const rows = tenders.filter((t) => t.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((sum, t) => sum + (t.tenderValue || 0), 0),
    };
  });
}

export interface PipelineSummary {
  openCount: number;
  openValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  winRate: number; // wonCount / (wonCount + lostCount), 0..1
}

export function pipelineSummary(tenders: Tender[]): PipelineSummary {
  const open = tenders.filter((t) => OPEN_STAGES.includes(t.stage));
  const won = tenders.filter((t) => t.stage === 'Won');
  const lost = tenders.filter((t) => t.stage === 'Lost');
  const closedCount = won.length + lost.length;
  return {
    openCount: open.length,
    openValue: open.reduce((s, t) => s + (t.tenderValue || 0), 0),
    wonCount: won.length,
    wonValue: won.reduce((s, t) => s + (t.tenderValue || 0), 0),
    lostCount: lost.length,
    lostValue: lost.reduce((s, t) => s + (t.tenderValue || 0), 0),
    winRate: closedCount > 0 ? won.length / closedCount : 0,
  };
}

export interface BrandBreakdownRow {
  brandId: string;
  brandName: string;
  submittedCount: number;
  submittedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
}

/** "Submitted" here means "ever entered the pipeline" (all stages), matching "total tender number/value by brand". */
export function brandBreakdown(tenders: Tender[]): BrandBreakdownRow[] {
  const map = new Map<string, BrandBreakdownRow>();
  for (const t of tenders) {
    const key = t.brandId || 'unassigned';
    if (!map.has(key)) {
      map.set(key, {
        brandId: key,
        brandName: t.brandName || 'Unassigned',
        submittedCount: 0,
        submittedValue: 0,
        wonCount: 0,
        wonValue: 0,
        lostCount: 0,
        lostValue: 0,
      });
    }
    const row = map.get(key)!;
    row.submittedCount += 1;
    row.submittedValue += t.tenderValue || 0;
    if (t.stage === 'Won') {
      row.wonCount += 1;
      row.wonValue += t.tenderValue || 0;
    } else if (t.stage === 'Lost') {
      row.lostCount += 1;
      row.lostValue += t.tenderValue || 0;
    }
  }
  return Array.from(map.values()).sort((a, b) => b.submittedValue - a.submittedValue);
}

export interface StaffPerformanceRow {
  ownerUid: string;
  ownerName: string;
  totalCount: number;
  totalValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  winRate: number;
}

export function staffPerformance(tenders: Tender[]): StaffPerformanceRow[] {
  const map = new Map<string, StaffPerformanceRow>();
  for (const t of tenders) {
    if (!map.has(t.ownerUid)) {
      map.set(t.ownerUid, {
        ownerUid: t.ownerUid,
        ownerName: t.ownerName || 'Unknown',
        totalCount: 0,
        totalValue: 0,
        wonCount: 0,
        wonValue: 0,
        lostCount: 0,
        winRate: 0,
      });
    }
    const row = map.get(t.ownerUid)!;
    row.totalCount += 1;
    row.totalValue += t.tenderValue || 0;
    if (t.stage === 'Won') {
      row.wonCount += 1;
      row.wonValue += t.tenderValue || 0;
    } else if (t.stage === 'Lost') {
      row.lostCount += 1;
    }
  }
  const rows = Array.from(map.values());
  for (const row of rows) {
    const closed = row.wonCount + row.lostCount;
    row.winRate = closed > 0 ? row.wonCount / closed : 0;
  }
  return rows.sort((a, b) => b.totalValue - a.totalValue);
}

export type RaceMetric = 'won' | 'submitted';
export type RaceTimeView = 'monthly' | 'ytd' | 'alltime' | 'yearly';

export interface RaceBar {
  department: string;
  value: number;
}

export interface RaceFrame {
  periodKey: string; // 'YYYY-MM' for monthly/ytd/alltime, 'YYYY' for yearly
  periodLabel: string;
  bars: RaceBar[]; // sorted descending by value
}

function raceMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function raceMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
}

/** One value, attributable to one branch, that happened on one date — the common input shape both race builders reduce to. */
interface RaceDatum {
  department: string;
  dateMillis: number;
  value: number;
}

/**
 * Shared frame-building core for every "branch race" chart: buckets a flat list of
 * (department, date, value) data points into monthly buckets, then assembles frames per the
 * requested time view.
 *
 * - timeView "monthly"/"yearly": each period shows only that period's own total (non-cumulative).
 * - timeView "ytd": a running total that resets back to zero every January.
 * - timeView "alltime": a running total since the very first record, never resets.
 */
function buildRaceFramesFromData(
  data: RaceDatum[],
  departments: string[],
  timeView: RaceTimeView
): RaceFrame[] {
  // month key ('YYYY-MM') -> department -> value in that month
  const monthly = new Map<string, Map<string, number>>();

  for (const d of data) {
    const key = raceMonthKey(new Date(d.dateMillis));
    if (!monthly.has(key)) monthly.set(key, new Map());
    const deptMap = monthly.get(key)!;
    deptMap.set(d.department, (deptMap.get(d.department) || 0) + (d.value || 0));
  }

  if (monthly.size === 0) return [];

  const dataMonthKeys = Array.from(monthly.keys()).sort();
  const firstKey = dataMonthKeys[0];
  const nowKey = raceMonthKey(new Date());
  const lastKey = dataMonthKeys[dataMonthKeys.length - 1] > nowKey ? dataMonthKeys[dataMonthKeys.length - 1] : nowKey;

  // Fill in every month between first and last (inclusive) so gaps don't break cumulative totals.
  const allMonthKeys: string[] = [];
  let [y, m] = firstKey.split('-').map(Number);
  const [ly, lm] = lastKey.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    allMonthKeys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  const rankedBars = (deptMap: Map<string, number>): RaceBar[] =>
    departments
      .map((department) => ({ department, value: deptMap.get(department) || 0 }))
      .sort((a, b) => b.value - a.value);

  if (timeView === 'yearly') {
    const yearlyDelta = new Map<string, Map<string, number>>();
    for (const key of allMonthKeys) {
      const year = key.split('-')[0];
      const deptMap = monthly.get(key);
      if (!deptMap) continue;
      if (!yearlyDelta.has(year)) yearlyDelta.set(year, new Map());
      const yMap = yearlyDelta.get(year)!;
      for (const [dept, val] of deptMap) yMap.set(dept, (yMap.get(dept) || 0) + val);
    }
    return Array.from(yearlyDelta.keys())
      .sort()
      .map((year) => ({ periodKey: year, periodLabel: year, bars: rankedBars(yearlyDelta.get(year)!) }));
  }

  const cumulative = new Map<string, number>();
  const frames: RaceFrame[] = [];
  let currentYear = '';

  for (const key of allMonthKeys) {
    const year = key.split('-')[0];
    if (timeView === 'ytd' && year !== currentYear) {
      cumulative.clear();
      currentYear = year;
    }
    const deltaMap = monthly.get(key) || new Map();

    if (timeView === 'monthly') {
      frames.push({ periodKey: key, periodLabel: raceMonthLabel(key), bars: rankedBars(deltaMap) });
    } else {
      for (const [dept, val] of deltaMap) cumulative.set(dept, (cumulative.get(dept) || 0) + val);
      frames.push({ periodKey: key, periodLabel: raceMonthLabel(key), bars: rankedBars(cumulative) });
    }
  }

  return frames;
}

/**
 * Builds frame-by-frame data for the sales-attribution "branch race" chart — which branch
 * WON the business.
 *
 * - metric "won": only Won tenders count, bucketed by their real closedDate (falls back to
 *   updatedAt if a closedDate is somehow missing), grouped by `department` (the branch that
 *   submitted/owns the tender).
 * - metric "submitted": every tender counts (regardless of stage), bucketed by when it was
 *   first created — i.e. when it entered the pipeline.
 */
export function buildRaceFrames(
  tenders: Tender[],
  departments: string[],
  metric: RaceMetric,
  timeView: RaceTimeView
): RaceFrame[] {
  const relevant = metric === 'won' ? tenders.filter((t) => t.stage === 'Won') : tenders;
  const data: RaceDatum[] = [];
  for (const t of relevant) {
    const raw = metric === 'won' ? t.closedDate || t.updatedAt : t.createdAt;
    const d = typeof raw === 'string' ? new Date(`${raw}T12:00:00`) : new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    data.push({ department: t.department, dateMillis: d.getTime(), value: t.tenderValue || 0 });
  }
  return buildRaceFramesFromData(data, departments, timeView);
}

/**
 * Builds frame-by-frame data for the Active Projects "branch race" chart — which branch is
 * currently RUNNING the awarded work. Only Won tenders count (that's what "active project"
 * means here), grouped by `activeBranch` (falling back to `department` for any tender that
 * predates the Active Projects feature and hasn't been backfilled yet), bucketed by
 * `contractStart` — the date the awarded contract begins.
 */
export function buildActiveProjectRaceFrames(
  tenders: Tender[],
  departments: string[],
  timeView: RaceTimeView
): RaceFrame[] {
  const data: RaceDatum[] = [];
  for (const t of tenders) {
    if (t.stage !== 'Won' || !t.contractStart) continue;
    const d = new Date(`${t.contractStart}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    data.push({ department: t.activeBranch || t.department, dateMillis: d.getTime(), value: t.tenderValue || 0 });
  }
  return buildRaceFramesFromData(data, departments, timeView);
}

export interface TrendPoint {
  date: string; // yyyy-mm-dd
  timestamp: number;
  openValue: number;
  wonValue: number;
  lostValue: number;
}

/**
 * Reconstructs "total pipeline value over time" by replaying the audit-trail of stage/value
 * changes in chronological order. Keeps one snapshot per calendar day (the last event of that
 * day) so the trend line stays readable even with many small edits.
 */
export function pipelineValueTrend(entries: TenderHistoryEntry[]): TrendPoint[] {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const state = new Map<string, { value: number; stage: Stage; removed: boolean }>();
  const byDay = new Map<string, TrendPoint>();

  for (const e of sorted) {
    if (e.type === 'deleted') {
      state.set(e.tenderId, { value: 0, stage: e.stage, removed: true });
    } else {
      state.set(e.tenderId, { value: e.value, stage: e.stage, removed: false });
    }
    let openValue = 0;
    let wonValue = 0;
    let lostValue = 0;
    for (const s of state.values()) {
      if (s.removed) continue;
      if (OPEN_STAGES.includes(s.stage)) openValue += s.value;
      else if (s.stage === 'Won') wonValue += s.value;
      else if (s.stage === 'Lost') lostValue += s.value;
    }
    const day = new Date(e.timestamp);
    const dateKey = day.toISOString().slice(0, 10);
    byDay.set(dateKey, { date: dateKey, timestamp: e.timestamp, openValue, wonValue, lostValue });
  }

  return Array.from(byDay.values()).sort((a, b) => a.timestamp - b.timestamp);
}
