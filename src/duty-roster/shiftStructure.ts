/**
 * Client Site Requirement / shift-structure derivation — ported verbatim from
 * public/duty-roster/index.html lines ~795-897.
 */
import type { ShiftDef, SiteRequirement } from "./types";
import { dowMon } from "./dateUtils";

export function computeShiftDefs(site: SiteRequirement): ShiftDef[] {
  const shiftHrs = Number(site.shiftHrs) || 0;
  const count = shiftHrs > 0 ? Math.max(0, Math.round((Number(site.hoursDay) || 0) / shiftHrs)) : 0;
  const defs: ShiftDef[] = [];
  for (let s = 0; s < count; s++) {
    const startHour = ((Number(site.rosterStart) || 0) + s * shiftHrs) % 24;
    const startHourNorm = ((startHour % 24) + 24) % 24;
    const night = !(startHourNorm >= 6 && startHourNorm < 18);
    let label: string;
    if (count <= 2) label = night ? "Night" : "Day";
    else label = "Shift " + (s + 1) + (night ? " (Night)" : " (Day)");
    defs.push({ id: "shift" + s, idx: s, label, startHour: startHourNorm, hours: shiftHrs, night });
  }
  return defs;
}

export function postsAt(site: SiteRequirement, dm: number, night: boolean): number {
  const we = dm >= 5;
  switch (site.pattern) {
    case "DN":
      return Number(night ? site.postsNight : site.postsDay) || 0;
    case "WW":
      return Number(we ? site.postsWe : site.postsWd) || 0;
    case "FULL":
      return (
        Number(
          we ? (night ? site.postsWeNight : site.postsWeDay) : night ? site.postsWdNight : site.postsWdDay
        ) || 0
      );
    case "FULLH":
      return 1;
    default:
      return Number(site.postsU) || 0;
  }
}

function fullHList(site: SiteRequirement, key: keyof SiteRequirement): number[] {
  const v = site[key] as unknown;
  return Array.isArray(v) && v.length ? (v as number[]) : [12];
}

export const FULLH_CATEGORIES = [
  { key: "shiftsWdDay" as const, we: false, night: false },
  { key: "shiftsWdNight" as const, we: false, night: true },
  { key: "shiftsWeDay" as const, we: true, night: false },
  { key: "shiftsWeNight" as const, we: true, night: true },
];

export function computeShiftDefsForDay(site: SiteRequirement, dm: number): ShiftDef[] {
  if (site.pattern !== "FULLH") return computeShiftDefs(site);
  const we = dm >= 5;
  const dayStart = ((Number(site.rosterStart) || 0) % 24 + 24) % 24;
  const nightStart = ((Number(site.nightStart) || 0) % 24 + 24) % 24;
  const dayList = fullHList(site, we ? "shiftsWeDay" : "shiftsWdDay");
  const nightList = fullHList(site, we ? "shiftsWeNight" : "shiftsWdNight");
  const defs: ShiftDef[] = [];
  dayList.forEach((hours, i) => {
    const h = Number(hours) || 0;
    if (h <= 0) return;
    defs.push({
      id: "day" + i,
      idx: defs.length,
      label: "Day" + (dayList.length > 1 ? " #" + (i + 1) : ""),
      startHour: dayStart,
      hours: h,
      night: false,
    });
  });
  nightList.forEach((hours, i) => {
    const h = Number(hours) || 0;
    if (h <= 0) return;
    defs.push({
      id: "night" + i,
      idx: defs.length,
      label: "Night" + (nightList.length > 1 ? " #" + (i + 1) : ""),
      startHour: nightStart,
      hours: h,
      night: true,
    });
  });
  return defs;
}

export function additionalGuardShiftOptions(site: SiteRequirement): { id: string; label: string }[] {
  if (site.pattern !== "FULLH") {
    return computeShiftDefs(site).map((sd) => ({ id: sd.id, label: sd.label }));
  }
  const seen = new Map<string, string>();
  [0, 5].forEach((dm) => {
    computeShiftDefsForDay(site, dm).forEach((sd) => {
      if (!seen.has(sd.id)) seen.set(sd.id, sd.label);
    });
  });
  return Array.from(seen, ([id, label]) => ({ id, label }));
}

export function coverageDaysPerWeek(site: SiteRequirement): number {
  return Math.min(7, Math.max(0, Math.round(Number(site.daysWeek) || 0)));
}

export interface SuggestedGuardCountConfig {
  site: SiteRequirement;
  restRule: { restDaysPerWeek: number };
}

export function suggestedGuardCount(config: SuggestedGuardCountConfig): {
  slotsWeek: number;
  maxDaySlots: number;
  workDaysWeek: number;
  suggested: number;
} {
  const site = config.site;
  const cov = coverageDaysPerWeek(site);
  let slotsWeek = 0;
  let maxDaySlots = 0;
  for (let dm = 0; dm < cov; dm++) {
    let daySlots = 0;
    computeShiftDefsForDay(site, dm).forEach((sd) => {
      const p = Math.max(0, postsAt(site, dm, sd.night));
      daySlots += p;
      slotsWeek += p;
    });
    if (daySlots > maxDaySlots) maxDaySlots = daySlots;
  }
  const restDaysWeek = Math.max(0, Math.min(6, Math.round(Number(config.restRule.restDaysPerWeek) || 0)));
  const workDaysWeek = 7 - restDaysWeek;
  const byRoster = workDaysWeek > 0 ? Math.ceil(slotsWeek / workDaysWeek) : 0;
  return { slotsWeek, maxDaySlots, workDaysWeek, suggested: Math.max(byRoster, maxDaySlots) };
}

export function maxConsecutiveDaysFor(config: { restRule: { restDaysPerWeek: number } }): number {
  const restDaysWeek = Math.max(0, Math.min(6, Math.round(Number(config.restRule.restDaysPerWeek) || 0)));
  return Math.max(1, 7 - restDaysWeek);
}

/** shiftLabelForKey() (index.html lines 3929-3934) — resolves a shift's display label fresh from
 * the site's CURRENT shift structure for that date's day-of-week (handles FULLH's per-day-varying
 * labels), since only the bare shiftId is ever persisted in an override/tempGuard/supportGuard
 * key. Used everywhere the Adjustments tab and Excel export need a human label for a stored key.
 * Falls back to the raw shiftId if the shift no longer exists in the current structure (e.g. the
 * site's pattern changed since the key was written). */
export function shiftLabelForKey(site: SiteRequirement, date: string, shiftId: string): string {
  const defs = computeShiftDefsForDay(site, dowMon(date));
  const st = defs.find((s) => s.id === shiftId);
  return st ? st.label : shiftId;
}
