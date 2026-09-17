/**
 * Calculation engine — ported line-for-line from public/quotation-calculator/index.html's
 * <script> block (contractTermMonths, miscCost, gradeAggregate, customWeek, postsAt, engine,
 * rosterPlan, driverRange/drawChart's series math). This file must stay numerically identical
 * to that original: it prices real client quotations, so every formula below is a direct
 * transliteration, not a rewrite. The one structural change from the original is that nothing
 * here mutates its inputs — the vanilla console stuck computed fields like `g._cp`/`e._sl`
 * directly onto each line item as a side effect of calc(); React state must stay immutable, so
 * those per-item breakdowns are returned as separate arrays instead (EngineResult.gradeItemCosts
 * / postBreakdown, and computeMiscBreakdown/computeFeeBreakdown below) — same numbers, different
 * shape.
 */
import { DAYS_PER_MONTH, DAYS_PER_WEEK, WEEKS_PER_MONTH } from './defaults';
import type {
  EngineResult,
  FeeItem,
  GradeItem,
  GradeItemCost,
  MiscItem,
  MiscItemCost,
  OtMode,
  PostItem,
  PostItemBreakdown,
  QuotationCollections,
  QuotationInputs,
  RosterPlanResult,
} from './types';

// ---------------------------------------------------------------------------
// Contract term
// ---------------------------------------------------------------------------

export function contractTermMonths(inputs: Pick<QuotationInputs, 'contractUnit' | 'contractMonths'>): number {
  const u = inputs.contractUnit || 'M';
  const q = isFinite(inputs.contractMonths) ? inputs.contractMonths : 0;
  let m = u === 'Y' ? q * 12 : u === 'D' ? q / DAYS_PER_MONTH : q;
  if (!(m > 0)) m = 1;
  return m;
}

// ---------------------------------------------------------------------------
// Misc / equipment cost
// ---------------------------------------------------------------------------

export function computeMiscItemCost(item: MiscItem, guards: number, periods: number, dayBasis: boolean): MiscItemCost {
  const q = isFinite(item.qty) ? item.qty : 0;
  const u = isFinite(item.unit) ? item.unit : 0;
  let p = 0;
  let t = 0;
  if (item.type === 'C') {
    t = q * u * guards;
    p = periods > 0 ? t / periods : 0;
  } else if (item.type === 'L') {
    t = q * u;
    p = periods > 0 ? t / periods : 0;
  } else {
    const pm = q * u;
    p = dayBasis ? pm / DAYS_PER_MONTH : pm;
    t = p * periods;
  }
  return { perPeriod: p, total: t };
}

export interface MiscTotals {
  per: number;
  total: number;
  perItem: MiscItemCost[];
}

export function miscCost(items: MiscItem[], guards: number, periods: number, dayBasis: boolean): MiscTotals {
  let per = 0;
  let total = 0;
  const perItem = items.map((it) => {
    const c = computeMiscItemCost(it, guards, periods, dayBasis);
    per += c.perPeriod;
    total += c.total;
    return c;
  });
  return { per, total, perItem };
}

// ---------------------------------------------------------------------------
// Management fee
// ---------------------------------------------------------------------------

export function feeTotalRate(items: FeeItem[]): number {
  let s = 0;
  for (const it of items) {
    const p = it.pct;
    if (isFinite(p)) s += p / 100;
  }
  return s;
}

export interface FeeItemAmount {
  perPeriod: number;
  total: number;
}

/** Per-fee-item display amounts — index.html's updateFeeAmounts(). Computed AFTER engine() since
 *  it needs R.revenuePP/R.periods; fee items never feed back into the quote itself (only
 *  feeTotalRate() does, via engine()'s feeRate/feeAmt/finalProfit). */
export function computeFeeBreakdown(items: FeeItem[], revenuePP: number, periods: number): FeeItemAmount[] {
  return items.map((it) => {
    const p = isFinite(it.pct) ? it.pct : 0;
    const amt = (revenuePP * p) / 100;
    return { perPeriod: amt, total: amt * periods };
  });
}

// ---------------------------------------------------------------------------
// Guard grades
// ---------------------------------------------------------------------------

/** Per-grade-item cost — index.html's gradeAggregate() inner loop body, factored out so it can
 *  run once per item regardless of which kind-bucket ('C'/'S') the item belongs to (the
 *  original recomputed this identically inside both the 'C' and 'S' calls — kind only decided
 *  which items were included in the sum, never changed the per-item formula itself). */
export function computeGradeItemCost(item: GradeItem, o: QuotationInputs, dayBasis: boolean): GradeItemCost {
  const zero: GradeItemCost = {
    n: 0, costPerPerson: 0, totalCost: 0, basic: 0, allow: 0,
    otPay: 0, rdPay: 0, rdOtPay: 0, phPay: 0, phOtPay: 0,
    gross: 0, epf: 0, socso: 0, eis: 0,
  };
  const n = Math.max(0, Math.round(item.n || 0));
  if (n <= 0) return zero;
  let na = Math.max(0, Math.round(item.na || 0));
  if (na > n) na = n;
  const gb = isFinite(item.basic) ? item.basic : 0;
  const ga = isFinite(item.allow) ? item.allow : 0;

  if (dayBasis) {
    const dR = o.salaryBasis === 'D' ? gb : o.workDaysMo > 0 ? gb / o.workDaysMo : 0;
    const dA = o.salaryBasis === 'D' ? ga : o.workDaysMo > 0 ? ga / o.workDaysMo : 0;
    const tot = n * dR + na * dA;
    return { ...zero, n, costPerPerson: tot / n, totalCost: tot, basic: n * dR, allow: na * dA, gross: tot };
  }

  const bm = o.salaryBasis === 'D' ? gb * o.workDaysMo : gb;
  const am = o.salaryBasis === 'D' ? ga * o.workDaysMo : ga;
  const nh = o.workDaysMo * o.normalHrs;
  const hr = nh > 0 ? bm / nh : 0;
  const ot = o.otMode === 'B' ? 0 : o.otMode === 'M' ? o.otHrs * hr * o.otMult : o.otHrs * o.otRate;
  const rd = o.otMode === 'B' ? 0 : o.rdDays * o.normalHrs * hr * o.rdMult;
  const rdo = o.otMode === 'B' ? 0 : o.otMode === 'M' ? o.rdOtHrs * hr * o.rdOtMult : o.rdOtHrs * o.rdOtRate;
  const ph = o.otMode === 'B' ? 0 : o.phDays * o.shiftHrs * hr * o.phMult;
  const pho = o.otMode === 'B' ? 0 : o.otMode === 'M' ? o.phOtHrs * hr * o.phOtMult : o.phOtHrs * o.phOtRate;

  let gTot = 0, totBasic = 0, totAllow = 0, totOt = 0, totRd = 0, totRdo = 0, totPh = 0, totPho = 0;
  let totGross = 0, totEpf = 0, totSocso = 0, totEis = 0;
  for (let k = 0; k < 2; k++) {
    const cnt = k === 0 ? na : n - na;
    if (cnt <= 0) continue;
    const al = k === 0 ? am : 0;
    const gr = bm + al + ot + rd + rdo + ph + pho;
    const cap = Math.min(gr, o.ceiling);
    const ep = (bm * o.epf) / 100;
    const so = (cap * o.socso) / 100;
    const ei = (cap * o.eis) / 100;
    const per = gr + ep + so + ei;
    gTot += cnt * per;
    totBasic += cnt * bm; totAllow += cnt * al;
    totOt += cnt * ot; totRd += cnt * rd; totRdo += cnt * rdo; totPh += cnt * ph; totPho += cnt * pho;
    totGross += cnt * gr; totEpf += cnt * ep; totSocso += cnt * so; totEis += cnt * ei;
  }
  return {
    n, costPerPerson: gTot / n, totalCost: gTot,
    basic: totBasic, allow: totAllow, otPay: totOt, rdPay: totRd, rdOtPay: totRdo, phPay: totPh, phOtPay: totPho,
    gross: totGross, epf: totEpf, socso: totSocso, eis: totEis,
  };
}

interface GradeAggregate {
  n: number; cost: number; basic: number; allow: number;
  otPay: number; rdPay: number; rdOtPay: number; phPay: number; phOtPay: number;
  gross: number; epf: number; socso: number; eis: number;
}

/** Sums per-item grade costs into one bucket ('C' or 'S') — index.html's gradeAggregate(),
 *  minus the per-item math (see computeGradeItemCost above) and minus the mutation. */
function sumGradeAggregate(items: GradeItem[], itemCosts: GradeItemCost[], kind: 'C' | 'S'): GradeAggregate {
  const out: GradeAggregate = { n: 0, cost: 0, basic: 0, allow: 0, otPay: 0, rdPay: 0, rdOtPay: 0, phPay: 0, phOtPay: 0, gross: 0, epf: 0, socso: 0, eis: 0 };
  items.forEach((item, i) => {
    if ((item.kind || 'S') !== kind) return;
    const c = itemCosts[i];
    out.n += c.n; out.cost += c.totalCost; out.basic += c.basic; out.allow += c.allow;
    out.otPay += c.otPay; out.rdPay += c.rdPay; out.rdOtPay += c.rdOtPay; out.phPay += c.phPay; out.phOtPay += c.phOtPay;
    out.gross += c.gross; out.epf += c.epf; out.socso += c.socso; out.eis += c.eis;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Custom post list (pattern === 'CUSTOM')
// ---------------------------------------------------------------------------

function postMatches(e: PostItem, dow: number): boolean {
  const dt = e.dayType || 'ALL';
  if (dt === 'ALL') return true;
  if (dt === 'WD') return dow < 5;
  return dow >= 5;
}

interface CustomWeekResult {
  slots: number;
  mh: number;
  maxDay: number;
  perItem: PostItemBreakdown[];
}

function customWeek(daysWeek: number, postItems: PostItem[]): CustomWeekResult {
  const cov = Math.min(7, Math.max(0, Math.round(daysWeek)));
  let slots = 0, mh = 0, maxDay = 0;
  const perItem: PostItemBreakdown[] = postItems.map(() => ({ slotsPerWeek: 0, manHoursPerWeek: 0 }));
  for (let dow = 0; dow < cov; dow++) {
    let ds = 0;
    postItems.forEach((e, j) => {
      if (!postMatches(e, dow)) return;
      const n = Math.max(0, Math.round(e.posts || 0));
      let h = e.hours;
      if (!isFinite(h) || h < 0) h = 0;
      ds += n; slots += n; mh += n * h;
      perItem[j].slotsPerWeek += n;
      perItem[j].manHoursPerWeek += n * h;
    });
    if (ds > maxDay) maxDay = ds;
  }
  return { slots, mh, maxDay, perItem };
}

// ---------------------------------------------------------------------------
// Post patterns (U / DN / WW / FULL)
// ---------------------------------------------------------------------------

function isNightShift(rosterStart: number, shiftHrs: number, s: number): boolean {
  const h = (((rosterStart + s * shiftHrs) % 24) + 24) % 24;
  return !(h >= 6 && h < 18);
}

function postsAt(o: QuotationInputs, dow: number, s: number): number {
  const we = dow >= 5;
  const ni = isNightShift(o.rosterStart, o.shiftHrs, s);
  if (o.pattern === 'DN') return ni ? o.postsNight : o.postsDay;
  if (o.pattern === 'WW') return we ? o.postsWe : o.postsWd;
  if (o.pattern === 'FULL') {
    if (we) return ni ? o.postsWeNight : o.postsWeDay;
    return ni ? o.postsWdNight : o.postsWdDay;
  }
  // 'U' and (deliberately, see rosterPlan()'s doc comment) 'CUSTOM' both fall through to postsU.
  return o.postsU;
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function engine(o: QuotationInputs, touched: boolean, collections: QuotationCollections): EngineResult {
  const { postItems, gradeItems, miscItems, feeItems } = collections;

  let shiftsPerDay = o.shiftHrs > 0 ? Math.round(o.hoursDay / o.shiftHrs) : 0;
  const cov = Math.min(7, Math.max(0, Math.round(o.daysWeek)));
  let slotsWeek = 0, manhoursWeek = 0, maxDaySlots = 0;
  let postBreakdown: PostItemBreakdown[] = postItems.map(() => ({ slotsPerWeek: 0, manHoursPerWeek: 0 }));

  if (o.pattern === 'CUSTOM') {
    const cw = customWeek(o.daysWeek, postItems);
    slotsWeek = cw.slots; manhoursWeek = cw.mh; maxDaySlots = cw.maxDay;
    postBreakdown = cw.perItem;
    shiftsPerDay = postItems.length;
  } else {
    for (let dow = 0; dow < cov; dow++) {
      let dayS = 0;
      for (let s = 0; s < shiftsPerDay; s++) {
        let p = postsAt(o, dow, s);
        if (!isFinite(p) || p < 0) p = 0;
        dayS += p; slotsWeek += p; manhoursWeek += p * o.shiftHrs;
      }
      if (dayS > maxDaySlots) maxDaySlots = dayS;
    }
  }

  const dayBasis = o.contractUnit === 'D';
  const workDaysWeek = DAYS_PER_WEEK - o.restDays;
  const byRoster = workDaysWeek > 0 ? Math.ceil(slotsWeek / workDaysWeek) : NaN;
  const suggested = dayBasis ? maxDaySlots : isFinite(byRoster) ? Math.max(byRoster, maxDaySlots) : NaN;
  let guards = touched ? o.guards : isFinite(suggested) ? suggested : o.guards;

  const basicMonthlyRaw = o.salaryBasis === 'D' ? o.basic * o.workDaysMo : o.basic;
  const dailyRate = o.salaryBasis === 'D' ? o.basic : o.workDaysMo > 0 ? o.basic / o.workDaysMo : 0;
  const months = contractTermMonths(o);
  const periods = dayBasis ? Math.max(1, o.contractMonths) : months;
  const pw: 'Daily' | 'Monthly' = dayBasis ? 'Daily' : 'Monthly';

  let normalHrsMo: number, hourly: number, otPay: number, rdPay: number, rdOtPay: number, phPay: number, phOtPay: number;
  let gross: number, epfAmt: number, socsoAmt: number, eisAmt: number, costGuard: number;
  let basicMonthly = basicMonthlyRaw;

  if (dayBasis) {
    normalHrsMo = o.shiftHrs;
    hourly = o.shiftHrs > 0 ? dailyRate / o.shiftHrs : NaN;
    otPay = 0; rdPay = 0; rdOtPay = 0; phPay = 0; phOtPay = 0;
    gross = dailyRate;
    epfAmt = 0; socsoAmt = 0; eisAmt = 0;
    costGuard = dailyRate;
  } else {
    normalHrsMo = o.workDaysMo * o.normalHrs;
    hourly = normalHrsMo > 0 ? basicMonthly / normalHrsMo : NaN;
    otPay = otModeAmount(o.otMode, o.otHrs, hourly, o.otMult, o.otRate);
    rdPay = o.otMode === 'B' ? 0 : o.rdDays * o.normalHrs * hourly * o.rdMult;
    rdOtPay = otModeAmount(o.otMode, o.rdOtHrs, hourly, o.rdOtMult, o.rdOtRate);
    phPay = o.otMode === 'B' ? 0 : o.phDays * o.shiftHrs * hourly * o.phMult;
    phOtPay = otModeAmount(o.otMode, o.phOtHrs, hourly, o.phOtMult, o.phOtRate);
    gross = basicMonthly + otPay + rdPay + rdOtPay + phPay + phOtPay;
    const capped = Math.min(gross, o.ceiling);
    epfAmt = (basicMonthly * o.epf) / 100;
    socsoAmt = (capped * o.socso) / 100;
    eisAmt = (capped * o.eis) / 100;
    costGuard = gross + epfAmt + socsoAmt + eisAmt;
  }
  let allowPay = 0;

  const bBasic = basicMonthly, bOt = otPay, bRd = rdPay, bRdo = rdOtPay, bPh = phPay, bPho = phOtPay;
  const bGross = gross, bEpf = epfAmt, bSo = socsoAmt, bEis = eisAmt, bCost = costGuard;

  const gradesOn = o.gradesOn === 'Y';
  const guardsRequired = guards;

  const gradeItemCosts: GradeItemCost[] = gradeItems.map((it) => computeGradeItemCost(it, o, dayBasis));
  const aggC = gradesOn ? sumGradeAggregate(gradeItems, gradeItemCosts, 'C') : null;
  const aggS = gradesOn ? sumGradeAggregate(gradeItems, gradeItemCosts, 'S') : null;
  let headC = aggC ? aggC.n : 0;
  const headSg = aggS ? aggS.n : 0;
  let headGraded = headC + headSg;
  let remaining = Math.max(0, guardsRequired - headGraded);
  let headS = headSg + remaining;
  let totalHead = headC + headS;
  let costC = aggC ? aggC.cost : 0;
  let costS = (aggS ? aggS.cost : 0) + remaining * bCost;

  if (!gradesOn) {
    headC = 0; headGraded = 0; remaining = guardsRequired; headS = guardsRequired; totalHead = guardsRequired;
    costC = 0; costS = guardsRequired * bCost;
  }
  guards = totalHead;

  if (totalHead > 0) {
    const sB = (aggC ? aggC.basic : 0) + (aggS ? aggS.basic : 0) + remaining * bBasic;
    const sA = (aggC ? aggC.allow : 0) + (aggS ? aggS.allow : 0);
    const sOt = (aggC ? aggC.otPay : 0) + (aggS ? aggS.otPay : 0) + remaining * bOt;
    const sRd = (aggC ? aggC.rdPay : 0) + (aggS ? aggS.rdPay : 0) + remaining * bRd;
    const sRdo = (aggC ? aggC.rdOtPay : 0) + (aggS ? aggS.rdOtPay : 0) + remaining * bRdo;
    const sPh = (aggC ? aggC.phPay : 0) + (aggS ? aggS.phPay : 0) + remaining * bPh;
    const sPho = (aggC ? aggC.phOtPay : 0) + (aggS ? aggS.phOtPay : 0) + remaining * bPho;
    const sGr = (aggC ? aggC.gross : 0) + (aggS ? aggS.gross : 0) + remaining * bGross;
    const sEp = (aggC ? aggC.epf : 0) + (aggS ? aggS.epf : 0) + remaining * bEpf;
    const sSo = (aggC ? aggC.socso : 0) + (aggS ? aggS.socso : 0) + remaining * bSo;
    const sEi = (aggC ? aggC.eis : 0) + (aggS ? aggS.eis : 0) + remaining * bEis;
    costGuard = (costC + costS) / totalHead;
    basicMonthly = sB / totalHead; allowPay = sA / totalHead;
    otPay = sOt / totalHead; rdPay = sRd / totalHead; rdOtPay = sRdo / totalHead;
    phPay = sPh / totalHead; phOtPay = sPho / totalHead;
    gross = sGr / totalHead; epfAmt = sEp / totalHead; socsoAmt = sSo / totalHead; eisAmt = sEi / totalHead;
  }

  const siteGuardCost = costC + costS;
  const misc = miscCost(miscItems, totalHead, periods, dayBasis);
  const costBase = siteGuardCost + misc.per;
  const fRate = feeTotalRate(feeItems);
  const feasible = fRate < 1;
  const manhours = dayBasis ? (cov > 0 ? manhoursWeek / cov : 0) : manhoursWeek * WEEKS_PER_MONTH;
  const shareC = totalHead > 0 ? headC / totalHead : 0;
  const mhC = manhours * shareC, mhS = manhours - mhC;
  const miscCShare = misc.per * shareC, miscSShare = misc.per - miscCShare;
  const siteCostC = costC + miscCShare, siteCostS = costS + miscSShare;
  const siteCost = siteCostC + siteCostS;
  const cpmC = mhC > 0 ? siteCostC / mhC : NaN;
  const quoteC = cpmC * (1 + o.compMarkup / 100);
  const revenueC = isFinite(quoteC) ? quoteC * mhC : 0;
  const profitC = revenueC - siteCostC;
  const cpmBill = mhS > 0 ? siteCostS / mhS : NaN;
  const quote = cpmBill * (1 + o.markup / 100);
  const revenueS = isFinite(quote) ? quote * mhS : 0;
  const revenue = revenueS + revenueC;
  const profit = revenue - siteCost;
  const margin = quote > 0 ? (quote - cpmBill) / quote : NaN;
  const marginTotal = revenue > 0 ? profit / revenue : NaN;
  const guardHrs = dayBasis
    ? o.shiftHrs
    : normalHrsMo + o.otHrs + o.rdDays * o.shiftHrs + o.rdOtHrs + o.phDays * o.shiftHrs + o.phOtHrs;
  const cpmGuard = guardHrs > 0 ? costGuard / guardHrs : NaN;

  return {
    shiftsDay: shiftsPerDay, slotsWeek, maxDaySlots, workDaysWeek, byRoster, suggested, guards, guardsRequired,
    normalHrsMo, hourly, allowPay, otPay, rdPay, rdOtPay, phPay, phOtPay, gross, epfAmt, socsoAmt, eisAmt,
    costGuard, costGuardPP: costGuard, basic: basicMonthly, dailyRate,
    months, periods, dayBasis, pw, pf: 1,
    siteGuardCost, siteGuardCostPP: siteGuardCost, miscMonthly: misc.per, miscPP: misc.per, miscTotal: misc.total,
    siteCost, siteCostPP: siteCost, costBase, manhours, manhoursPP: manhours, cpmBill, cpmGuard,
    quote, margin, revenue, revenuePP: revenue, profit, profitPP: profit, marginTotal,
    contractManhours: manhours * periods, contractRevenue: revenue * periods,
    contractCost: siteCost * periods, contractProfit: profit * periods, contractGuardCost: siteGuardCost * periods,
    feeRate: fRate, feasible, feeAmt: fRate * revenue, contractFee: fRate * revenue * periods,
    finalProfit: profit - fRate * revenue, contractFinalProfit: (profit - fRate * revenue) * periods,
    finalMargin: revenue > 0 ? (profit - fRate * revenue) / revenue : NaN,
    gradesOn, gradeCost: siteGuardCost, headGraded, remaining, totalHead, headC, headS, mhC, mhS,
    siteCostC, siteCostS, cpmC, quoteC, revenueC, profitC, marginC: quoteC > 0 ? (quoteC - cpmC) / quoteC : NaN,
    gradeItemCosts, postBreakdown, miscBreakdown: misc.perItem,
  };
}

function otModeAmount(mode: OtMode, hrs: number, hourly: number, mult: number, fixedRate: number): number {
  if (mode === 'B') return 0;
  if (mode === 'M') return hrs * hourly * mult;
  return hrs * fixedRate;
}

// ---------------------------------------------------------------------------
// Guard labels (grade-aware) — index.html's guardLabel()
// ---------------------------------------------------------------------------

export function guardLabel(i: number, gradesOn: boolean, gradeItems: GradeItem[]): string {
  if (!gradesOn) return 'Guard ' + (i + 1);
  let k = 0;
  for (const g of gradeItems) {
    if ((g.kind || 'S') !== 'C') continue;
    const nc = Math.max(0, Math.round(g.n || 0));
    if (i < k + nc) return g.name + ' ' + (i - k + 1);
    k += nc;
  }
  for (const g of gradeItems) {
    if ((g.kind || 'S') === 'C') continue;
    const ns = Math.max(0, Math.round(g.n || 0));
    if (i < k + ns) return g.name + ' ' + (i - k + 1);
    k += ns;
  }
  return 'Security Guard ' + (i - k + 1);
}

// ---------------------------------------------------------------------------
// Roster preview — index.html's rosterPlan()
// ---------------------------------------------------------------------------

/**
 * NOTE on pattern === 'CUSTOM': the original rosterPlan() computes its own `shiftsPerDay` as
 * `shiftHrs>0 ? round(hoursDay/shiftHrs) : 0` — unlike engine(), it never overrides this to
 * postItems.length for CUSTOM — and calls the same postsAt() the U/DN/WW/FULL patterns use,
 * which falls through to `postsU` for any pattern it doesn't recognise (i.e. 'CUSTOM' itself).
 * So in the original tool, the Duty Roster Suggestion preview silently ignores the custom post
 * list and previews against "Guard Posts (all shifts, all days)" instead — a real quirk of the
 * page being ported, not a bug introduced here. It doesn't affect any billed figure (roster
 * preview is display-only), so this port reproduces it byte-for-byte rather than silently
 * changing what the preview shows.
 */
export function rosterPlan(o: QuotationInputs, postItems: PostItem[], guardsUsed: number, days: number, startDow: number, seed: number): RosterPlanResult {
  const guards = Math.max(0, Math.round(guardsUsed));
  const shiftsPerDay = o.shiftHrs > 0 ? Math.round(o.hoursDay / o.shiftHrs) : 0;
  const cov = Math.min(7, Math.max(0, Math.round(o.daysWeek)));
  const grid: (import('./types').RosterCell | null)[][] = [];
  const counts: number[] = [];
  for (let g = 0; g < guards; g++) {
    grid.push(new Array(days).fill(null));
    counts.push(0);
  }
  let idx = guards > 0 ? ((seed % guards) + guards) % guards : 0;
  let unfilled = 0, required = 0, maxDaySlots = 0;
  for (let d = 0; d < days; d++) {
    const dow = (startDow + d) % 7;
    if (dow >= cov) continue;
    let dayS = 0;
    for (let s = 0; s < shiftsPerDay; s++) {
      let np = postsAt(o, dow, s);
      if (!isFinite(np) || np < 0) np = 0;
      np = Math.round(np);
      dayS += np;
      for (let pp = 1; pp <= np; pp++) {
        required++;
        let placed = false;
        for (let t = 0; t < guards; t++) {
          const g2 = (idx + t) % guards;
          if (!grid[g2][d]) {
            grid[g2][d] = { shift: s, post: pp };
            counts[g2]++;
            idx = idx + t + 1;
            placed = true;
            break;
          }
        }
        if (!placed) { unfilled++; idx++; }
      }
    }
    if (dayS > maxDaySlots) maxDaySlots = dayS;
  }
  void postItems; // kept in the signature for symmetry with engine()/customWeek() call sites; unused here (see doc comment above)
  return { grid, counts, guards, shiftsPerDay, slotsPerDay: maxDaySlots, cov, days, startDow, unfilled, required };
}

export function shiftWindow(rosterStart: number, shiftHrs: number, i: number): string {
  const a = (((rosterStart + i * shiftHrs) % 24) + 24) % 24;
  const b = (((rosterStart + (i + 1) * shiftHrs) % 24) + 24) % 24;
  return pad2(a) + ':00-' + pad2(b) + ':00';
}

function pad2(n: number): string {
  const f = Math.floor(n);
  return (f < 10 ? '0' : '') + f;
}

// ---------------------------------------------------------------------------
// Sensitivity chart series — index.html's driverRange()/drawChart() math (SVG drawing itself
// lives in the React component; this is just the {x,y} series + axis range).
// ---------------------------------------------------------------------------

export type SensitivityDriverKey = 'markup' | 'guards' | 'basic' | 'otHrs' | 'otX';
export type ResolvedDriverKey = 'markup' | 'guards' | 'basic' | 'otHrs' | 'otRate' | 'otMult';

export function resolveDriverKey(key: SensitivityDriverKey, otMode: OtMode): ResolvedDriverKey {
  if (key === 'otX') return otMode === 'M' ? 'otMult' : 'otRate';
  return key;
}

export function driverRange(key: ResolvedDriverKey, cur: number): [number, number, number] {
  if (key === 'markup') return [0, 60, 1];
  if (key === 'guards') return [Math.max(1, Math.round(cur * 0.5)), Math.round(cur * 1.5) + 2, 2];
  if (key === 'basic') return [Math.max(0, Math.round((cur * 0.6) / 50) * 50), Math.round((cur * 1.4) / 50) * 50, 0];
  if (key === 'otHrs') return [0, Math.max(40, Math.round(cur * 2)), 0];
  if (key === 'otRate') return [0, Math.max(10, Math.round(cur * 2)), 2];
  // 'otMult'
  return [0, Math.max(2, cur * 2), 2];
}

export interface SensitivityPoint {
  x: number;
  y: number;
}

export interface SensitivitySeries {
  points: SensitivityPoint[];
  lo: number;
  hi: number;
  dp: number;
  current: SensitivityPoint | null;
}

const SENSITIVITY_SAMPLES = 40;

export function computeSensitivitySeries(
  inputs: QuotationInputs,
  collections: QuotationCollections,
  guardsTouched: boolean,
  driverKey: SensitivityDriverKey
): SensitivitySeries {
  const key = resolveDriverKey(driverKey, inputs.otMode);
  const cur = inputs[key];
  const [lo, hi, dp] = driverRange(key, cur);
  if (!(hi > lo)) return { points: [], lo, hi, dp, current: null };
  const points: SensitivityPoint[] = [];
  for (let i = 0; i <= SENSITIVITY_SAMPLES; i++) {
    const x = lo + ((hi - lo) * i) / SENSITIVITY_SAMPLES;
    const o2 = { ...inputs, [key]: x };
    const touched = key === 'guards' ? true : guardsTouched;
    const q = engine(o2, touched, collections).quote;
    points.push({ x, y: q });
  }
  let current: SensitivityPoint | null = null;
  if (cur >= lo && cur <= hi) {
    const oCur = { ...inputs, [key]: cur };
    const touched = key === 'guards' ? true : guardsTouched;
    const cq = engine(oCur, touched, collections).quote;
    if (isFinite(cq)) current = { x: cur, y: cq };
  }
  return { points, lo, hi, dp, current };
}
