/**
 * Domain types for the Quotation Calculator — ported 1:1 from the standalone vanilla-JS app at
 * public/quotation-calculator/index.html (see that file's own header comment, still present
 * there for history, and QuotationCalculatorPage.tsx for why this port exists). Field names
 * intentionally match the legacy console's variable names exactly (postsU, rdOtMult, etc.) so
 * this stays a faithful port rather than a redesign — no data migration is needed for anything
 * that was only ever kept in a saved quotation's `state` blob (see Quotation below).
 */

// ---------------------------------------------------------------------------
// Scalar inputs — one field per number input the legacy console tracked in its
// `ids` array (index.html line ~536), plus the accompanying <select> values.
// ---------------------------------------------------------------------------

export type PostPattern = 'U' | 'DN' | 'WW' | 'FULL' | 'CUSTOM';
export type ContractUnit = 'D' | 'M' | 'Y';
export type SalaryBasis = 'M' | 'D';
export type GradesOn = 'Y' | 'N';
/** 'F' = Fixed OT Rate, 'M' = Multiplier OT Rate, 'B' = Only Basic (no overtime, rest day or
 *  public holiday pay at all — cost is basic salary only). */
export type OtMode = 'F' | 'M' | 'B';
/** "RBA/SMETA compliance mode" — same toggle/constant as the Duty Roster (see
 *  src/duty-roster/complianceRules.ts for what it covers and why one flat weekly-hours number
 *  satisfies RBA, SMETA/ETI and Malaysia's Employment Act at once). When 'Y', the engine raises
 *  `suggested` (and therefore `guards`, when guards is untouched) to whatever headcount keeps
 *  every guard under COMPLIANCE_MAX_WEEKLY_HOURS/week, so the quote itself reflects compliant
 *  staffing rather than just the bare roster-coverage minimum. */
export type ComplianceMode = 'Y' | 'N';

export interface QuotationScalarInputs {
  postsU: number;
  postsDay: number;
  postsNight: number;
  postsWd: number;
  postsWe: number;
  postsWdDay: number;
  postsWdNight: number;
  postsWeDay: number;
  postsWeNight: number;
  hoursDay: number;
  daysWeek: number;
  shiftHrs: number;
  restDays: number;
  normalHrs: number;
  guards: number;
  basic: number;
  workDaysMo: number;
  otHrs: number;
  otRate: number;
  otMult: number;
  rdDays: number;
  rdMult: number;
  rdOtHrs: number;
  rdOtRate: number;
  rdOtMult: number;
  phDays: number;
  phMult: number;
  phOtHrs: number;
  phOtRate: number;
  phOtMult: number;
  epf: number;
  socso: number;
  eis: number;
  ceiling: number;
  markup: number;
  compMarkup: number;
  contractMonths: number;
  rosterStart: number;
}

export const SCALAR_INPUT_IDS: (keyof QuotationScalarInputs)[] = [
  'postsU', 'postsDay', 'postsNight', 'postsWd', 'postsWe',
  'postsWdDay', 'postsWdNight', 'postsWeDay', 'postsWeNight',
  'hoursDay', 'daysWeek', 'shiftHrs', 'restDays', 'normalHrs', 'guards',
  'basic', 'workDaysMo', 'otHrs', 'otRate', 'otMult',
  'rdDays', 'rdMult', 'rdOtHrs', 'rdOtRate', 'rdOtMult',
  'phDays', 'phMult', 'phOtHrs', 'phOtRate', 'phOtMult',
  'epf', 'socso', 'eis', 'ceiling', 'markup', 'compMarkup',
  'contractMonths', 'rosterStart',
];

export interface QuotationInputs extends QuotationScalarInputs {
  pattern: PostPattern;
  contractUnit: ContractUnit;
  salaryBasis: SalaryBasis;
  gradesOn: GradesOn;
  otMode: OtMode;
  complianceMode: ComplianceMode;
}

// ---------------------------------------------------------------------------
// Editable line-item collections (Client Site Requirement custom posts, Guard
// Grades, Misc/Equipment, Management Fee).
// ---------------------------------------------------------------------------

export type PostDayType = 'WD' | 'WE' | 'ALL';
export type PostPeriod = 'D' | 'N';

/** One "custom post list" block — index.html's postItems[] (only used when pattern==='CUSTOM'). */
export interface PostItem {
  dayType: PostDayType;
  period: PostPeriod;
  posts: number;
  hours: number;
}

export type GradeKind = 'C' | 'S';

/** One guard grade — index.html's gradeItems[]. 'C' (compulsory) grades are billed to the
 *  client separately (section 6b); 'S' (special) grades pool with the remaining security
 *  guards and bill at the main rate (section 6). `na` is the "with allowance" headcount within
 *  `n` (capped to `n` at calc time — see computeGradeItemCost). */
export interface GradeItem {
  kind: GradeKind;
  name: string;
  n: number;
  basic: number;
  allow: number;
  na: number;
}

export type MiscType = 'C' | 'L' | 'R';

/** One misc/equipment line — index.html's miscItems[]. 'C' = compulsory (qty per guard x
 *  Guards Required, spread over the contract term), 'L' = lump sum (one-off, term average),
 *  'R' = monthly rental (charged every period of the term). */
export interface MiscItem {
  type: MiscType;
  name: string;
  qty: number;
  unit: number;
}

/** One management fee line — index.html's feeItems[]. Charged as a percentage of revenue
 *  billed to the client; deducted from gross profit, never added to the quoted rate. */
export interface FeeItem {
  name: string;
  pct: number;
}

export interface QuotationCollections {
  postItems: PostItem[];
  gradeItems: GradeItem[];
  miscItems: MiscItem[];
  feeItems: FeeItem[];
}

// ---------------------------------------------------------------------------
// Engine result — index.html's engine()'s return object (R). Every guard-cost,
// site-cost, quote, margin and contract figure the UI displays comes from here.
// ---------------------------------------------------------------------------

export interface EngineResult {
  // Roster / headcount math
  shiftsDay: number;
  slotsWeek: number;
  maxDaySlots: number;
  workDaysWeek: number;
  byRoster: number;
  /** Total guard-hours/week the roster requires (sum of posts x shift-hours) — always computed,
   *  regardless of complianceMode, since it's cheap and useful on its own. */
  weeklyManHours: number;
  /** Minimum headcount from COMPLIANCE_MAX_WEEKLY_HOURS/guard/week alone, hours treated as freely
   *  divisible (a loose bound — real shifts aren't divisible). 0 when complianceMode is 'N'. */
  byManHours: number;
  /** Minimum headcount from exact discrete-shift capacity (floor(cap/shiftHrs) whole shifts/guard/
   *  week, capped by workDaysWeek) — the tight, correct bound for every pattern except CUSTOM,
   *  whose per-block shift lengths vary, where this falls back to byManHours. 0 when
   *  complianceMode is 'N'. */
  byShiftCapacity: number;
  /** What `suggested` below would be if complianceMode were 'N' — kept so the UI can show "N (was
   *  M without compliance mode)". */
  suggestedWithoutCompliance: number;
  suggested: number;
  guards: number;
  guardsRequired: number;

  // Per-guard monthly (or daily) cost build-up — blended across grades + remaining guards
  normalHrsMo: number;
  hourly: number;
  allowPay: number;
  otPay: number;
  rdPay: number;
  rdOtPay: number;
  phPay: number;
  phOtPay: number;
  gross: number;
  epfAmt: number;
  socsoAmt: number;
  eisAmt: number;
  costGuard: number;
  costGuardPP: number;
  basic: number;
  dailyRate: number;

  // Contract term
  months: number;
  periods: number;
  dayBasis: boolean;
  pw: 'Daily' | 'Monthly';
  pf: 1;

  // Site totals
  siteGuardCost: number;
  siteGuardCostPP: number;
  miscMonthly: number;
  miscPP: number;
  miscTotal: number;
  siteCost: number;
  siteCostPP: number;
  costBase: number;
  manhours: number;
  manhoursPP: number;
  cpmBill: number;
  cpmGuard: number;

  // Client quote — main stream
  quote: number;
  margin: number;
  revenue: number;
  revenuePP: number;
  profit: number;
  profitPP: number;
  marginTotal: number;

  // Contract (full-term) figures
  contractManhours: number;
  contractRevenue: number;
  contractCost: number;
  contractProfit: number;
  contractGuardCost: number;

  // Management fee
  feeRate: number;
  feasible: boolean;
  feeAmt: number;
  contractFee: number;
  finalProfit: number;
  contractFinalProfit: number;
  finalMargin: number;

  // Guard grades
  gradesOn: boolean;
  gradeCost: number;
  headGraded: number;
  remaining: number;
  totalHead: number;
  headC: number;
  headS: number;
  mhC: number;
  mhS: number;
  siteCostC: number;
  siteCostS: number;
  cpmC: number;
  quoteC: number;
  revenueC: number;
  profitC: number;
  marginC: number;

  // Per-item breakdowns — kept separate from the mutated-in-place `_cp`/`_tc`/etc. fields the
  // vanilla console stuck directly on each item; React state must stay immutable, so these are
  // returned alongside R instead, index-aligned with the collections passed into engine().
  gradeItemCosts: GradeItemCost[];
  postBreakdown: PostItemBreakdown[];
  miscBreakdown: MiscItemCost[];
}

/** Per-grade-item cost breakdown — the vanilla console's g._cp (costPerPerson) / g._tc
 *  (totalCost), computed once per item independent of kind (kind only decides which aggregate
 *  bucket an item's totals get summed into — see gradeAggregate's doc comment in engine.ts). */
export interface GradeItemCost {
  n: number;
  costPerPerson: number;
  totalCost: number;
  basic: number;
  allow: number;
  otPay: number;
  rdPay: number;
  rdOtPay: number;
  phPay: number;
  phOtPay: number;
  gross: number;
  epf: number;
  socso: number;
  eis: number;
}

/** Per-post-item breakdown — the vanilla console's e._sl (slotsPerWeek) / e._mh
 *  (manHoursPerWeek), only meaningful when pattern==='CUSTOM'. */
export interface PostItemBreakdown {
  slotsPerWeek: number;
  manHoursPerWeek: number;
}

/** Per-misc-item cost breakdown — the vanilla console's it._m (perPeriod) / it._t (total). */
export interface MiscItemCost {
  perPeriod: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Roster preview
// ---------------------------------------------------------------------------

export interface RosterCell {
  shift: number;
  post: number;
}

export interface RosterPlanResult {
  grid: (RosterCell | null)[][]; // [guardIndex][dayIndex]
  counts: number[];
  guards: number;
  shiftsPerDay: number;
  slotsPerDay: number; // max slots on the busiest covered day
  cov: number;
  days: number;
  startDow: number;
  unfilled: number;
  required: number;
}

// ---------------------------------------------------------------------------
// Scenario comparison
// ---------------------------------------------------------------------------

export interface ScenarioSnapshot {
  inputs: QuotationInputs;
  touched: boolean;
  postPattern: PostPattern;
  result: EngineResult;
}

export type ScenarioSlots = [ScenarioSnapshot | null, ScenarioSnapshot | null, ScenarioSnapshot | null];

// ---------------------------------------------------------------------------
// Saved quotation state — exactly what index.html's collectState()/applyState()
// round-trip, so an existing saved quotation (Firestore doc or exported .json
// backup) loads correctly under this port with no migration.
// ---------------------------------------------------------------------------

export interface QuotationState {
  inputs: QuotationInputs;
  otMode: OtMode;
  guardsTouched: boolean;
  adjTouched: boolean;
  adjRate: number;
  rosterView: '7' | '14' | 'M';
  rosterMonth: number;
  rosterYear: number;
  postItems: PostItem[];
  gradeItems: GradeItem[];
  miscItems: MiscItem[];
  feeItems: FeeItem[];
}

/** A saved quotation record — Firestore doc under /quotations/{id} (see firestore.rules'
 *  /quotations block) or an entry in an exported/imported backup .json. Mirrors the vanilla
 *  console's saveQuotation()/loadQuotation() record shape field-for-field. */
export interface Quotation {
  id: string;
  clientName: string;
  site: string;
  notes: string;
  savedAt: string; // ISO timestamp
  quotedRate: number;
  guardsUsed: number;
  state: QuotationState;
  /** Branch this quotation belongs to, or null/absent for Admin/HQ "Unassigned". */
  branch: string | null;
  createdByUid: string | null;
  createdByName: string;
  /** True for anything saved under a 'developer' testing account — see shouldStampTestData()
   *  in services/settings.ts, the same convention used everywhere else in this CRM. */
  isTestData?: boolean;
}
