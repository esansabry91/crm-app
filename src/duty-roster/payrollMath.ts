/**
 * Payroll math (Summary Report / Combined Hours) — ported verbatim from
 * public/duty-roster/index.html lines ~2886-3149.
 *
 * Classification precedence for one worked day (accumulateWorkedDay, exact order): public
 * holiday (whole shift is holiday-OT, regardless of the 26-day count) > first NORMAL_WORK_DAYS
 * non-holiday days = normal (excess over site.normalHoursPerDay = normal OT) > any further
 * non-holiday day = rest-day work (the WHOLE shift, not just the excess, counts as rest-day OT).
 *
 * Support-elsewhere days are never "normal" — always rest-day-worked or holiday-worked,
 * unconditionally, regardless of the guard's home 26-day counter at the time
 * (accumulateSupportDay). Rationale: a support assignment can only ever be offered to a guard
 * who's already free at home that exact day, so by construction that day was already a day off
 * (or holiday) at home — classifying it against a shared quota, or independently at the
 * destination, would both under- and over-count his home quota usage.
 */
import type { GenerateMonthResult, MonthState } from "./types";
import { activeSupportIds, monthSupportGuards, monthTempGuards } from "./rosterModel";
import { computeShiftDefsForDay } from "./shiftStructure";
import { configHolidays } from "./holidays";
import { guardRate, supportGuardRate } from "./rateResolution";
import type { TenderRateConfig } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { leaveEntriesFor } from "./rosterModel";

/** The fixed monthly quota: the guard's first 26 non-holiday worked days in a month are
 * "normal," everything past that (still non-holiday) is rest-day work, unconditionally. */
export const NORMAL_WORK_DAYS = 26;

export interface GuardSummaryEntry {
  manHours: number;
  normalDays: number;
  restDaysWorked: number;
  holidayDaysWorked: number;
  normalOTHours: number;
  restOTHours: number;
  holidayOTHours: number;
  mc: number;
  absent: number;
  leave: number;
  unpaidLeave: number;
  /** Running counter only, not part of the report. */
  _nonHolidayWorked?: number;
}

/** Classifies ONE worked-day entry (an actual shift assignment, hours already known) into
 * normal / rest-day / public-holiday and adds it to `s` IN PLACE, matching the original. */
export function accumulateWorkedDay(
  s: GuardSummaryEntry,
  hours: number,
  isHoliday: boolean,
  normalThreshold: number
): void {
  s.manHours += hours;
  if (isHoliday) {
    s.holidayDaysWorked++;
    s.holidayOTHours += Math.max(0, hours - normalThreshold);
  } else {
    s._nonHolidayWorked = (s._nonHolidayWorked || 0) + 1;
    if (s._nonHolidayWorked <= NORMAL_WORK_DAYS) {
      s.normalDays++;
      s.normalOTHours += Math.max(0, hours - normalThreshold);
    } else {
      s.restDaysWorked++;
      s.restOTHours += Math.max(0, hours - normalThreshold);
    }
  }
}

function initEntry(): GuardSummaryEntry {
  return {
    manHours: 0, normalDays: 0, restDaysWorked: 0, holidayDaysWorked: 0,
    normalOTHours: 0, restOTHours: 0, holidayOTHours: 0,
    mc: 0, absent: 0, leave: 0, unpaidLeave: 0,
    _nonHolidayWorked: 0,
  };
}

/** Per-guard totals for config guards + temp guards + support guards. Leave-reason tallies come
 * straight from the leave log, independent of whether that day needed covering; "Support (Other
 * Site)" is explicitly excluded from MC/Absent/Leave/Unpaid tallies (see LEAVE_REASONS). */
export function computeGuardSummary(
  _y: number,
  _m: number,
  config: GenerateMonthConfig,
  monthState: MonthState,
  result: GenerateMonthResult
): Record<string, GuardSummaryEntry> {
  const holidays = new Set(configHolidays(config as Parameters<typeof configHolidays>[0]));
  const normalThreshold = Number(config.site.normalHoursPerDay) || 8;
  const summary: Record<string, GuardSummaryEntry> = {};
  config.guards.forEach((g) => {
    summary[g.id] = initEntry();
  });
  // Temp/relief guards get an entry too (same shape) so their own shifts are tallied below —
  // callers that only want permanent-guard stats should look up by config.guards ids only.
  Object.keys(monthTempGuards(monthState)).forEach((id) => {
    summary[id] = initEntry();
  });
  // Same for support guards — a real guard from another site covering a slot HERE. Their hours
  // count toward THIS site's manHours total — this site genuinely had them working.
  Object.keys(monthSupportGuards(monthState)).forEach((id) => {
    summary[id] = initEntry();
  });

  result.days.forEach((day) => {
    const dateStr = day.dateStr;
    const isHoliday = holidays.has(dateStr);
    const shiftDefs = computeShiftDefsForDay(config.site, day.dm);

    leaveEntriesFor(monthState, dateStr).forEach((e) => {
      const s = summary[e.id];
      if (!s) return; // guard since removed from the roster
      if (e.reason === "Medical leave (MC)") s.mc++;
      else if (e.reason === "Absent") s.absent++;
      else if (e.reason === "Unpaid Leave") s.unpaidLeave++;
      else if (e.reason === "Support (Other Site)") {
        /* not an absence — see LEAVE_REASONS comment; deliberately not tallied here */
      } else s.leave++; // "Leave", or any legacy/unrecognized reason
    });

    day.assignments.forEach((slotsForShift, stIdx) => {
      const st = shiftDefs[stIdx];
      if (!st) return;
      slotsForShift.forEach((guardId) => {
        if (!guardId) return;
        const s = summary[guardId];
        if (!s) return; // a guard no longer in the roster (temp guards have an entry — see above)
        accumulateWorkedDay(s, st.hours, isHoliday, normalThreshold);
      });
    });
  });

  return summary;
}

/** Zero-valued starting point for a computeGuardSummary()-shaped breakdown. */
export function emptyGuardBreakdown(): Omit<GuardSummaryEntry, "_nonHolidayWorked"> {
  return {
    manHours: 0, normalDays: 0, restDaysWorked: 0, holidayDaysWorked: 0,
    normalOTHours: 0, restOTHours: 0, holidayOTHours: 0, mc: 0, absent: 0, leave: 0, unpaidLeave: 0,
  };
}

/** Adds `src` (a computeGuardSummary()-shaped breakdown, or null/undefined) field-by-field into
 * `target` IN PLACE. Used to accumulate per-guard Combined-panel totals into a grand total row. */
export function addGuardBreakdown(
  target: Omit<GuardSummaryEntry, "_nonHolidayWorked">,
  src: Omit<GuardSummaryEntry, "_nonHolidayWorked"> | null | undefined
): void {
  if (!src) return;
  target.manHours += src.manHours || 0;
  target.normalDays += src.normalDays || 0;
  target.restDaysWorked += src.restDaysWorked || 0;
  target.holidayDaysWorked += src.holidayDaysWorked || 0;
  target.normalOTHours += src.normalOTHours || 0;
  target.restOTHours += src.restOTHours || 0;
  target.holidayOTHours += src.holidayOTHours || 0;
  target.mc += src.mc || 0;
  target.absent += src.absent || 0;
  target.leave += src.leave || 0;
  target.unpaidLeave += src.unpaidLeave || 0;
}

/** Every day guard `guardId` actually worked at THIS site this month, as {dateStr, hours} pairs
 * — one entry per shift assigned, not yet classified normal/rest/holiday. Used to gather a
 * support guard's raw worked days at the SIBLING (destination) site he covered a shift at. */
export function guardWorkedDayList(
  config: GenerateMonthConfig,
  result: GenerateMonthResult,
  guardId: string
): { dateStr: string; hours: number }[] {
  const list: { dateStr: string; hours: number }[] = [];
  result.days.forEach((day) => {
    const shiftDefs = computeShiftDefsForDay(config.site, day.dm);
    day.assignments.forEach((slotsForShift, stIdx) => {
      const st = shiftDefs[stIdx];
      if (!st) return;
      slotsForShift.forEach((gid) => {
        if (gid === guardId) list.push({ dateStr: day.dateStr, hours: st.hours });
      });
    });
  });
  return list;
}

/** Classifies ONE support-elsewhere worked-day entry into holiday-worked (if it falls on the
 * HOME site's own public holiday) or rest-day-worked (every other case) — never "normal", and
 * never subject to the 26-day quota accumulateWorkedDay() enforces for a guard's own home
 * shifts. A support day is always one or the other because the destination could only ever have
 * offered this guard the shift by seeing him as free at home that day — i.e. already a rest day
 * (or a public holiday) there — whatever his home 26-day counter happened to read at the time. */
export function accumulateSupportDay(
  s: Omit<GuardSummaryEntry, "_nonHolidayWorked">,
  hours: number,
  isHoliday: boolean
): void {
  s.manHours += hours;
  if (isHoliday) {
    s.holidayDaysWorked++;
    s.holidayOTHours += hours;
  } else {
    s.restDaysWorked++;
    s.restOTHours += hours;
  }
}

/** A guard's Combined breakdown for the "Combined hours" panel/export. His home-site totals are
 * taken straight from `homeSummaryEntry` (computeGuardSummary()'s own, already-correct
 * classification), completely unchanged. Each support-elsewhere day (`supportDates`, raw
 * {dateStr,hours} pairs) is then added on top via accumulateSupportDay(), always as rest-day- or
 * holiday-worked, never "normal" and never competing with his home shifts for a slot in the
 * 26-day quota. Deliberately NOT a merged-and-reclassified-together day list sharing one 26-day
 * counter across home + support days — see this function's header comment in the original for
 * why that under/over-counts. */
export function combinedGuardBreakdown(
  config: GenerateMonthConfig,
  homeSummaryEntry: GuardSummaryEntry | undefined,
  supportDates: { dateStr: string; hours: number }[] | undefined
): Omit<GuardSummaryEntry, "_nonHolidayWorked"> {
  const combined = emptyGuardBreakdown();
  const hs = homeSummaryEntry || ({} as Partial<GuardSummaryEntry>);
  combined.manHours = hs.manHours || 0;
  combined.normalDays = hs.normalDays || 0;
  combined.restDaysWorked = hs.restDaysWorked || 0;
  combined.holidayDaysWorked = hs.holidayDaysWorked || 0;
  combined.normalOTHours = hs.normalOTHours || 0;
  combined.restOTHours = hs.restOTHours || 0;
  combined.holidayOTHours = hs.holidayOTHours || 0;
  combined.mc = hs.mc || 0;
  combined.absent = hs.absent || 0;
  combined.leave = hs.leave || 0;
  combined.unpaidLeave = hs.unpaidLeave || 0;

  const holidays = new Set(configHolidays(config as Parameters<typeof configHolidays>[0]));
  (supportDates || []).forEach((entry) => accumulateSupportDay(combined, entry.hours, holidays.has(entry.dateStr)));
  return combined;
}

/** Grand total of every Additional Guard (Temporary) post's hours this month, across however
 * many guards (real/temp/support) covered one. */
export function totalExtraGuardManHours(result: GenerateMonthResult): number {
  const eh = result.extraGuardHours || {};
  return Object.keys(eh).reduce((s, id) => s + (eh[id] || 0), 0);
}

export interface SummaryTotals {
  manHours: number;
  amount: number;
  anyMissingRate: boolean;
  additionalManHours: number;
  hasAnyGuards: boolean;
}

/** Standalone numeric total (man-hours + RM amount across permanent, temp and support guards)
 * used to SNAPSHOT a month's figures at the moment "Confirm for invoicing" is clicked.
 * Additional Guard (Temporary) posts bill separately in Branch Collection, at whatever rate that
 * category's own line row uses — NOT this guard's own configured rate — so those hours are
 * excluded here and surfaced instead as their own additionalManHours. */
export function computeSummaryTotals(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  monthState: MonthState,
  result: GenerateMonthResult,
  rateConfig: TenderRateConfig | null
): SummaryTotals {
  const summary = computeGuardSummary(y, m, config, monthState, result);
  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const tempIds = Object.keys(monthTempGuards(monthState));
  const supportIds = activeSupportIds(monthState);
  const n = (v: number | undefined) => v || 0;
  const extraGuardHours = result.extraGuardHours || {};
  const normalManHours = (id: string) => Math.max(0, n(summary[id] && summary[id].manHours) - n(extraGuardHours[id]));
  let manHours = 0;
  let amount = 0;
  let anyMissingRate = false;
  guards.forEach((g) => {
    const hrs = normalManHours(g.id);
    manHours += hrs;
    const rate = guardRate(rateConfig, g);
    if (rate == null) anyMissingRate = true;
    amount += rate != null ? rate * hrs : 0;
  });
  [...tempIds, ...supportIds].forEach((id) => {
    const hrs = normalManHours(id);
    manHours += hrs;
    const rate = supportGuardRate(rateConfig);
    if (rate == null) anyMissingRate = true;
    amount += rate != null ? rate * hrs : 0;
  });
  return {
    manHours,
    amount,
    anyMissingRate,
    additionalManHours: totalExtraGuardManHours(result),
    hasAnyGuards: !!(guards.length || tempIds.length || supportIds.length),
  };
}

export function normalHoursLabel(config: GenerateMonthConfig): number {
  return Number(config.site.normalHoursPerDay) || 8;
}

export function formatConfirmedAt(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
