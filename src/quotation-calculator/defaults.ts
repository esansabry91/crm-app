/**
 * Default state — the literal `value=`/`selected` attributes baked into
 * public/quotation-calculator/index.html's markup, and the initial postItems/gradeItems/
 * miscItems/feeItems arrays it declares at script load. "Reset defaults" (resetAll() in the
 * vanilla console) and "New Quotation" both return to exactly this state, so these values must
 * stay byte-for-byte what the original page shipped with.
 */
import type {
  FeeItem,
  GradeItem,
  MiscItem,
  PostItem,
  QuotationInputs,
  QuotationScalarInputs,
} from './types';

export const DEFAULT_SCALAR_INPUTS: QuotationScalarInputs = {
  postsU: 5,
  postsDay: 5,
  postsNight: 3,
  postsWd: 5,
  postsWe: 3,
  postsWdDay: 5,
  postsWdNight: 4,
  postsWeDay: 3,
  postsWeNight: 2,
  hoursDay: 24,
  daysWeek: 7,
  shiftHrs: 12,
  restDays: 1,
  normalHrs: 8,
  guards: 12,
  basic: 1700,
  workDaysMo: 26,
  otHrs: 104,
  otRate: 6.13,
  otMult: 0.75,
  rdDays: 4,
  rdMult: 1,
  rdOtHrs: 16,
  rdOtRate: 8.17,
  rdOtMult: 1,
  phDays: 0,
  phMult: 1,
  phOtHrs: 0,
  phOtRate: 8.17,
  phOtMult: 1,
  epf: 13,
  socso: 1.75,
  eis: 0.2,
  ceiling: 5000,
  markup: 20,
  compMarkup: 25,
  contractMonths: 12,
  rosterStart: 7,
};

export const DEFAULT_INPUTS: QuotationInputs = {
  ...DEFAULT_SCALAR_INPUTS,
  pattern: 'U',
  contractUnit: 'M',
  salaryBasis: 'M',
  gradesOn: 'N',
  otMode: 'F',
  complianceMode: 'N',
};

export function defaultPostItems(): PostItem[] {
  return [
    { dayType: 'WD', period: 'D', posts: 1, hours: 12 },
    { dayType: 'WD', period: 'D', posts: 2, hours: 16 },
    { dayType: 'WE', period: 'N', posts: 1, hours: 12 },
  ];
}

export function defaultGradeItems(): GradeItem[] {
  return [
    { kind: 'C', name: 'Site Supervisor', n: 1, basic: 2200, allow: 300, na: 1 },
    { kind: 'C', name: 'Site Leader', n: 2, basic: 1900, allow: 200, na: 2 },
    { kind: 'S', name: 'Armed / Special Guard', n: 2, basic: 1900, allow: 150, na: 2 },
  ];
}

export function defaultMiscItems(): MiscItem[] {
  return [
    { type: 'C', name: 'Guard uniform (set)', qty: 3, unit: 85 },
    { type: 'C', name: 'Safety shoes (pair)', qty: 2, unit: 70 },
  ];
}

export function defaultFeeItems(): FeeItem[] {
  return [{ name: 'Head office management fee', pct: 5 }];
}

/** New blank line-item templates ("Add ..." buttons) — index.html's addMiscC/L/R, addGradeC/S,
 *  addFee, addPost literal object shapes. */
export const NEW_MISC_COMPULSORY: Omit<MiscItem, 'unit'> & { unit: number } = { type: 'C', name: 'New compulsory item', qty: 1, unit: 0 };
export const NEW_MISC_LUMP_SUM: MiscItem = { type: 'L', name: 'New lump sum item', qty: 1, unit: 0 };
export const NEW_MISC_RENTAL: MiscItem = { type: 'R', name: 'New rental item', qty: 1, unit: 0 };
export const NEW_GRADE_COMPULSORY: GradeItem = { kind: 'C', name: 'New compulsory grade', n: 1, basic: 2000, allow: 0, na: 0 };
export const NEW_GRADE_SPECIAL: GradeItem = { kind: 'S', name: 'New special grade', n: 1, basic: 1800, allow: 0, na: 0 };
export const NEW_FEE_ITEM: FeeItem = { name: 'New fee item', pct: 0 };
export const NEW_POST_ITEM: PostItem = { dayType: 'WD', period: 'D', posts: 1, hours: 12 };

export const WEEKS_PER_MONTH = 4.348;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = WEEKS_PER_MONTH * DAYS_PER_WEEK;
