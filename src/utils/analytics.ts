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

/** Every month key ('YYYY-MM') from `firstKey` through `lastKey`, inclusive. */
function monthKeysBetween(firstKey: string, lastKey: string): string[] {
  const result: string[] = [];
  let [y, m] = firstKey.split('-').map(Number);
  const [ly, lm] = lastKey.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return result;
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
  const allMonthKeys = monthKeysBetween(firstKey, lastKey);

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

export type ActiveProjectRaceMetric = 'value' | 'guards';

/**
 * Builds frame-by-frame data for the Active Projects "branch race" chart — which branch is
 * currently RUNNING the awarded work. Only Won tenders count (that's what "active project"
 * means here), grouped by `activeBranch` (falling back to `department` for any tender that
 * predates the Active Projects feature and hasn't been backfilled yet), bucketed by
 * `contractStart` — the date the awarded contract begins.
 *
 * `metric` picks what's summed per branch per bucket: contract value (RM), or how many security
 * guards are deployed there — same "who's running what, over time" shape, different unit.
 */
export function buildActiveProjectRaceFrames(
  tenders: Tender[],
  departments: string[],
  timeView: RaceTimeView,
  metric: ActiveProjectRaceMetric = 'value'
): RaceFrame[] {
  const data: RaceDatum[] = [];
  for (const t of tenders) {
    if (t.stage !== 'Won' || !t.contractStart) continue;
    const d = new Date(`${t.contractStart}T12:00:00`);
    if (Number.isNaN(d.getTime())) continue;
    const value = metric === 'guards' ? t.guardsDeployed || 0 : t.tenderValue || 0;
    data.push({ department: t.activeBranch || t.department, dateMillis: d.getTime(), value });
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

/**
 * One bar in a waterfall/bridge chart. A 'total' bar is an actual running value (a start-of- or
 * end-of-period anchor); a 'delta' bar is the signed change contributed between two anchors
 * (positive = bar rises, negative = bar falls).
 */
export interface WaterfallBar {
  label: string;
  amount: number;
  kind: 'total' | 'delta';
}

/** Month options ('YYYY-MM' keys, with a display label) for a bridge chart's Prev/Next navigator. */
export interface MonthOption {
  key: string;
  label: string;
}

function monthRangeOptions(monthKeys: string[]): MonthOption[] {
  const now = new Date();
  const nowKey = raceMonthKey(now);
  const keys = monthKeys.length > 0 ? monthKeys : [nowKey];
  const sorted = [...keys].sort();
  const firstKey = sorted[0];
  const lastKey = sorted[sorted.length - 1] > nowKey ? sorted[sorted.length - 1] : nowKey;
  return monthKeysBetween(firstKey, lastKey).map((key) => ({ key, label: raceMonthLabel(key) }));
}

/**
 * Every navigable month ('YYYY-MM') for the Active Project Value bridge — from the earliest
 * contract start through the current month, so Prev/Next always lands somewhere with data (or at
 * least the current month, if there's none yet).
 */
export function activeProjectBridgeMonths(tenders: Tender[]): MonthOption[] {
  const keys = tenders
    .filter((t) => t.stage === 'Won' && t.contractStart)
    .map((t) => t.contractStart.slice(0, 7));
  return monthRangeOptions(keys);
}

/**
 * Builds the Active Project Value bridge for one calendar month: start-of-month active value,
 * plus contracts that newly went active this month (by `contractStart`), minus projects closed
 * out this month (by `closedOutAt`), equals end-of-month active value.
 *
 * `tenders` should be every Won tender in scope (active AND already closed-out — see
 * useWonTenders) so closed-out projects still contribute their exit from the month they left in;
 * usePastProjects/useActiveProjects alone would each only have half the picture.
 *
 * Reopening a project (closeOutProject reversed) doesn't leave a trace of when it was closed —
 * that's deliberate: a reopened project is treated as having been active all along, which is the
 * correct "current understanding" even though it changes what an already-elapsed month's bridge
 * would have shown while it was still closed out.
 */
export function activeProjectValueBridge(tenders: Tender[], monthKey: string): WaterfallBar[] {
  const [y, m] = monthKey.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1).getTime();
  const monthEnd = new Date(y, m, 1).getTime();

  let startValue = 0;
  let enteringValue = 0;
  let exitingValue = 0;

  for (const t of tenders) {
    if (t.stage !== 'Won' || !t.contractStart) continue;
    const startMs = new Date(`${t.contractStart}T12:00:00`).getTime();
    if (Number.isNaN(startMs)) continue;
    const closedMs = t.closedOutAt ?? null;
    const value = t.tenderValue || 0;

    if (startMs < monthStart && (closedMs === null || closedMs >= monthStart)) {
      startValue += value;
    }
    if (startMs >= monthStart && startMs < monthEnd) {
      enteringValue += value;
    }
    if (closedMs !== null && closedMs >= monthStart && closedMs < monthEnd) {
      exitingValue += value;
    }
  }

  const endValue = startValue + enteringValue - exitingValue;

  const bars: WaterfallBar[] = [{ label: 'Start of Month', amount: startValue, kind: 'total' }];
  if (enteringValue !== 0) bars.push({ label: 'New Contracts', amount: enteringValue, kind: 'delta' });
  if (exitingValue !== 0) bars.push({ label: 'Closed Out', amount: -exitingValue, kind: 'delta' });
  bars.push({ label: 'End of Month', amount: endValue, kind: 'total' });
  return bars;
}

/** Internal replay state shared by pipelineValueTrend and pipelineValueBridge. */
interface TenderReplayState {
  value: number;
  stage: Stage;
  removed: boolean;
}

function applyHistoryEntry(state: Map<string, TenderReplayState>, e: TenderHistoryEntry) {
  if (e.type === 'deleted') {
    state.set(e.tenderId, { value: 0, stage: e.stage, removed: true });
  } else {
    state.set(e.tenderId, { value: e.value, stage: e.stage, removed: false });
  }
}

function openValueOf(state: Map<string, TenderReplayState>): number {
  let sum = 0;
  for (const s of state.values()) {
    if (!s.removed && OPEN_STAGES.includes(s.stage)) sum += s.value;
  }
  return sum;
}

/**
 * Every navigable month ('YYYY-MM') for the Pipeline Value bridge, from the earliest history
 * entry through the current month.
 */
export function pipelineBridgeMonths(entries: TenderHistoryEntry[]): MonthOption[] {
  const keys = entries.map((e) => raceMonthKey(new Date(e.timestamp)));
  return monthRangeOptions(keys);
}

/**
 * Builds the open Pipeline Value bridge for one calendar month by replaying the full audit
 * trail: start-of-month open pipeline value, plus new tenders entering the pipeline, plus/minus
 * tenders moving between open stages with a value correction, minus tenders that moved to Won,
 * minus tenders that moved to Lost, minus tenders deleted while still open, equals end-of-month
 * open pipeline value. Every delta bucket is a real, reconciling contributor — start + every
 * delta always sums to exactly the end value — which is what makes a shrinking end value
 * meaningful to read: whether it shrank because deals were Won (good) or Lost / never replaced
 * by new intake (not good) is visible in which bars moved, not just the final number.
 */
export function pipelineValueBridge(entries: TenderHistoryEntry[], monthKey: string): WaterfallBar[] {
  const [y, m] = monthKey.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1).getTime();
  const monthEnd = new Date(y, m, 1).getTime();

  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const state = new Map<string, TenderReplayState>();

  let i = 0;
  for (; i < sorted.length && sorted[i].timestamp < monthStart; i++) {
    applyHistoryEntry(state, sorted[i]);
  }
  const startValue = openValueOf(state);

  let newValue = 0;
  let wonValue = 0;
  let lostValue = 0;
  let removedValue = 0;
  let adjustValue = 0;

  for (; i < sorted.length && sorted[i].timestamp < monthEnd; i++) {
    const e = sorted[i];
    const prev = state.get(e.tenderId);
    const prevOpen = !!prev && !prev.removed && OPEN_STAGES.includes(prev.stage);
    const prevValue = prevOpen ? prev!.value : 0;

    if (e.type === 'deleted') {
      if (prevOpen) removedValue -= prevValue;
      applyHistoryEntry(state, e);
      continue;
    }

    applyHistoryEntry(state, e);
    const nowOpen = OPEN_STAGES.includes(e.stage);

    if (e.type === 'created') {
      if (nowOpen) newValue += e.value; // created directly as Won/Lost never touched the open pool
    } else if (e.type === 'stage_change') {
      if (prevOpen && !nowOpen) {
        if (e.stage === 'Won') wonValue -= prevValue;
        else if (e.stage === 'Lost') lostValue -= prevValue;
      } else if (!prevOpen && nowOpen) {
        newValue += e.value; // reopened from a closed stage back into the pipeline
      } else if (prevOpen && nowOpen && prevValue !== e.value) {
        adjustValue += e.value - prevValue;
      }
    } else if (e.type === 'value_change' && prevOpen && nowOpen) {
      adjustValue += e.value - prevValue;
    }
  }

  const endValue = startValue + newValue + wonValue + lostValue + removedValue + adjustValue;

  const bars: WaterfallBar[] = [{ label: 'Start of Month', amount: startValue, kind: 'total' }];
  if (newValue !== 0) bars.push({ label: 'New Tenders', amount: newValue, kind: 'delta' });
  if (wonValue !== 0) bars.push({ label: 'Won', amount: wonValue, kind: 'delta' });
  if (lostValue !== 0) bars.push({ label: 'Lost', amount: lostValue, kind: 'delta' });
  if (removedValue !== 0) bars.push({ label: 'Removed', amount: removedValue, kind: 'delta' });
  if (adjustValue !== 0) bars.push({ label: 'Value Adjustments', amount: adjustValue, kind: 'delta' });
  bars.push({ label: 'End of Month', amount: endValue, kind: 'total' });
  return bars;
}
