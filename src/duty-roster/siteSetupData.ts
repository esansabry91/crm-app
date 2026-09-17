/**
 * Guards & Shifts tab — "Client site requirement", "Rest rules", and "Public holidays" panels.
 * Ported from public/duty-roster/index.html's renderSiteStateSelect()/renderHolidayTable()/
 * renderSiteRequirement()/renderFullHFields()/renderSitePostsFields()/renderRestInputs()/
 * renderSetupGate() and their Save/Add/Remove button handlers (lines ~3561-3813, 5001-5156).
 *
 * Same pure-reducer shape as lockMachine.ts: every "apply*" function takes the current
 * SiteConfig/MonthState and returns new ones plus a toast string — no Firestore, no DOM. The
 * caller (a hook) is responsible for persisting `config` (via useSiteConfig) and `ms` (via
 * useMonthState) together, matching the original's paired persistConfig()+addLog() calls (every
 * one of these actions logs to the CURRENTLY VIEWED month's change log even though what changed
 * is the site-level config doc, not the month doc — ported faithfully, not "fixed").
 */
import type { SiteConfig, SiteRequirement, MonthState, ShiftPattern } from "./types";
import { deepClone } from "./rosterModel";
import { markSiteSetupDirty, markSiteSetupSaved, siteSetupSaved } from "./rosterModel";
import { appendLog } from "./lockMachine";
import {
  MALAYSIA_STATES,
  configHolidays,
  configHolidayNames,
  applyStateHolidays,
} from "./holidays";
import {
  FULLH_CATEGORIES,
  coverageDaysPerWeek,
  suggestedGuardCount,
  maxConsecutiveDaysFor,
  computeShiftDefs,
  computeShiftDefsForDay,
} from "./shiftStructure";

export interface ConfigActionOutcome {
  config: SiteConfig;
  ms: MonthState;
  toast: string;
}

// ---------------------------------------------------------------------------
// State select / public holidays
// ---------------------------------------------------------------------------

export { MALAYSIA_STATES };

/** #siteStateSub help text (renderSiteStateSelect(), lines 3568-3575). */
export function siteStateSubText(cfg: Pick<SiteConfig, "state">): string {
  if (cfg.state) {
    return `Auto-filled from the ${cfg.state} calendar (federal + state holidays, 2026–2027) — add or remove dates below any time.`;
  }
  return "Assigning a state auto-fills federal + that state's own gazetted public holidays below — you can still add or remove dates by hand any time.";
}

/** Whether picking `nextState` needs a confirm modal first (only when a DIFFERENT state was
 * already assigned) — mirrors the #siteStateSelect change handler's own branch (line 5029). When
 * this returns false, the caller should apply immediately with no confirm step. */
export function stateChangeNeedsConfirm(cfg: Pick<SiteConfig, "state">, nextState: string | null): boolean {
  return !!cfg.state && cfg.state !== nextState;
}

/** Exact confirm-modal copy for a state reassignment — title is always "Change assigned state?". */
export function stateChangeConfirmMessage(cfg: Pick<SiteConfig, "state">, nextState: string | null): string {
  if (nextState) {
    return `Switch this site from ${cfg.state} to ${nextState}? ${cfg.state}'s auto-filled public holidays will be replaced with ${nextState}'s — any dates you added by hand are kept.`;
  }
  return `Remove this site's ${cfg.state} state assignment? Its auto-filled public holidays will be removed — any dates you added by hand are kept.`;
}

/** Applies a (possibly-just-confirmed) state assignment/clear. */
export function applyStateAssignment(config: SiteConfig, ms: MonthState, nextState: string | null): ConfigActionOutcome {
  const nextConfig = deepClone(config);
  const count = applyStateHolidays(nextConfig, nextState);
  markSiteSetupDirty(nextConfig, "holidays");
  const logText = nextState
    ? `Assigned this site to ${nextState} — auto-filled ${count} public holiday date${count === 1 ? "" : "s"} from the state calendar.`
    : "Cleared this site's assigned state and its auto-filled public holidays.";
  const nextMs = appendLog(ms, logText);
  const toast = nextState ? `Applied ${nextState}'s public holidays.` : "Cleared the state assignment.";
  return { config: nextConfig, ms: nextMs, toast };
}

export interface HolidayRow {
  date: string;
  name: string | null;
}

/** buildHolidayRows() — renderHolidayTable()'s data, dates sorted ascending. */
export function buildHolidayRows(cfg: SiteConfig): HolidayRow[] {
  const names = configHolidayNames(cfg);
  return configHolidays(cfg)
    .slice()
    .sort()
    .map((date) => ({ date, name: names[date] || null }));
}

/** #addHolidayBtn handler (line 5011). Returns null (no-op, caller should toast the message
 * itself) for the two validation failures; otherwise the applied outcome. */
export function applyAddHoliday(
  config: SiteConfig,
  ms: MonthState,
  dateStr: string,
  nameRaw: string
): ConfigActionOutcome | { error: string } {
  if (!dateStr) return { error: "Pick a date first." };
  if (configHolidays(config).includes(dateStr)) return { error: "That date is already marked as a public holiday." };
  const name = nameRaw.trim();
  const nextConfig = deepClone(config);
  nextConfig.publicHolidays = [...configHolidays(nextConfig), dateStr];
  if (name) nextConfig.holidayNames = { ...(nextConfig.holidayNames || {}), [dateStr]: name };
  markSiteSetupDirty(nextConfig, "holidays");
  const nextMs = appendLog(ms, `Added public holiday ${dateStr}${name ? ` (${name})` : ""}.`);
  return { config: nextConfig, ms: nextMs, toast: `Added ${dateStr} as a public holiday.` };
}

/** Remove-holiday confirm message (label = "name (date)" or bare date). */
export function removeHolidayConfirmMessage(date: string, name: string | null): string {
  const label = name ? `${name} (${date})` : date;
  return `Remove ${label} from this site's public holidays? Any shifts already worked on this date will no longer count as holiday work in the Summary Report.`;
}

/** Note: deliberately does NOT distinguish auto (state-calendar) vs hand-added dates, and does
 * NOT touch `stateHolidayDates` — matches the original exactly (see the module doc comment on
 * this pre-existing nuance: a later state re-apply can re-add a removed auto date). */
export function applyRemoveHoliday(config: SiteConfig, ms: MonthState, date: string): ConfigActionOutcome {
  const names = configHolidayNames(config);
  const removedName = names[date] || null;
  const nextConfig = deepClone(config);
  nextConfig.publicHolidays = configHolidays(nextConfig).filter((d) => d !== date);
  if (nextConfig.holidayNames) {
    const { [date]: _removed, ...rest } = nextConfig.holidayNames;
    nextConfig.holidayNames = rest;
  }
  markSiteSetupDirty(nextConfig, "holidays");
  const nextMs = appendLog(ms, `Removed public holiday ${date}${removedName ? ` (${removedName})` : ""}.`);
  return { config: nextConfig, ms: nextMs, toast: `Removed ${date} from public holidays.` };
}

/** #saveHolidaysBtn — writes nothing new (every add/remove already applied above), just clears
 * the "dirty" save-gate flag. */
export function applySaveHolidays(config: SiteConfig, ms: MonthState): ConfigActionOutcome {
  const nextConfig = deepClone(config);
  markSiteSetupSaved(nextConfig, "holidays");
  const nextMs = appendLog(ms, "Confirmed public holidays for this site.");
  return { config: nextConfig, ms: nextMs, toast: "Public holidays saved." };
}

// ---------------------------------------------------------------------------
// Client site requirement
// ---------------------------------------------------------------------------

export const FULLH_FIELD_LABELS: Record<(typeof FULLH_CATEGORIES)[number]["key"], string> = {
  shiftsWdDay: "Weekday — day shift guard posts",
  shiftsWdNight: "Weekday — night shift guard posts",
  shiftsWeDay: "Weekend — day shift guard posts",
  shiftsWeNight: "Weekend — night shift guard posts",
};

type FlatPostsField =
  | "postsU"
  | "postsDay"
  | "postsNight"
  | "postsWd"
  | "postsWe"
  | "postsWdDay"
  | "postsWdNight"
  | "postsWeDay"
  | "postsWeNight";

/** PATTERN_FIELD_GROUPS — which flat posts fields each non-FULLH pattern edits, in display order. */
export const PATTERN_FIELD_GROUPS: Record<Exclude<ShiftPattern, "FULLH">, { key: FlatPostsField; label: string }[]> = {
  U: [{ key: "postsU", label: "Guard posts (all shifts, all days)" }],
  DN: [
    { key: "postsDay", label: "Guard posts — day shift" },
    { key: "postsNight", label: "Guard posts — night shift" },
  ],
  WW: [
    { key: "postsWd", label: "Guard posts — weekday (Mon–Fri)" },
    { key: "postsWe", label: "Guard posts — weekend (Sat–Sun)" },
  ],
  FULL: [
    { key: "postsWdDay", label: "Guard posts — weekday day shift" },
    { key: "postsWdNight", label: "Guard posts — weekday night shift" },
    { key: "postsWeDay", label: "Guard posts — weekend day shift" },
    { key: "postsWeNight", label: "Guard posts — weekend night shift" },
  ],
};

export interface SiteRequirementFormValues {
  pattern: ShiftPattern;
  /** Only the flat posts fields PATTERN_FIELD_GROUPS[pattern] shows — any other pattern's fields
   * are left untouched, matching the original (only the fields actually rendered get saved
   * over). Ignored when pattern is "FULLH". */
  posts?: Partial<Record<FlatPostsField, number>>;
  /** FULLH pattern only. Each list is filtered to values > 0 at save time, falling back to
   * `[12]` if the filtered list is empty — matches the original's save-time "at least one
   * post" enforcement (not just at remove-time). */
  fullH?: {
    nightStart: number;
    shiftsWdDay: number[];
    shiftsWdNight: number[];
    shiftsWeDay: number[];
    shiftsWeNight: number[];
  };
  hoursDay: number;
  daysWeek: number;
  shiftHrs: number;
  rosterStart: number;
  normalHoursPerDay: number;
}

/** #saveSiteBtn handler (line 5112). */
export function applySaveSiteRequirement(config: SiteConfig, ms: MonthState, form: SiteRequirementFormValues): ConfigActionOutcome {
  const nextConfig = deepClone(config);
  const site: SiteRequirement = { ...nextConfig.site, pattern: form.pattern };

  if (form.pattern === "FULLH" && form.fullH) {
    site.nightStart = Number(form.fullH.nightStart) || 0;
    (Object.keys(FULLH_FIELD_LABELS) as (keyof typeof FULLH_FIELD_LABELS)[]).forEach((key) => {
      const raw = form.fullH![key] || [];
      const filtered = raw.map((v) => Number(v) || 0).filter((v) => v > 0);
      site[key] = filtered.length ? filtered : [12];
    });
  } else if (form.posts) {
    Object.assign(site, form.posts);
  }

  site.hoursDay = Number(form.hoursDay) || 0;
  site.daysWeek = Number(form.daysWeek) || 0;
  site.shiftHrs = Number(form.shiftHrs) || 0;
  site.rosterStart = Number(form.rosterStart) || 0;
  site.normalHoursPerDay = Number(form.normalHoursPerDay) || 8;

  nextConfig.site = site;
  nextConfig.isSample = false;
  markSiteSetupSaved(nextConfig, "site");

  const nextMs = appendLog(
    ms,
    `Updated client site requirement (pattern: ${site.pattern}, ${site.hoursDay}h/day coverage, ${site.daysWeek} days/week).`
  );
  return { config: nextConfig, ms: nextMs, toast: "Site requirement saved." };
}

export interface SiteSummary {
  /** Everything before the bolded suggested-headcount number (the original wraps just that
   * number in `<strong>`, e.g. "...Suggested headcount from this scenario: "). */
  before: string;
  suggested: number;
  /** Always "." — kept as a field rather than a literal so the component doesn't hardcode it. */
  after: string;
}

/** #siteSummary computed text (renderSiteRequirement(), lines ~3760-3783). Structured (rather
 * than a single string with embedded `<strong>`) the same way conflictsData.ts's ConflictItem
 * is, so the bold styling stays a component concern. */
export function siteSummary(config: Pick<SiteConfig, "site" | "restRule">): SiteSummary {
  const site = config.site;
  const cov = coverageDaysPerWeek(site);
  const sug = suggestedGuardCount(config);

  const describe = (defs: { label: string; startHour: number; hours: number }[]): string => {
    if (!defs.length) return "none — check coverage hours and hours per shift";
    return defs.map((d) => `${d.label} ${String(d.startHour).padStart(2, "0")}:00 (${d.hours}h)`).join(", ");
  };

  let shiftLine: string;
  if (site.pattern === "FULLH") {
    const wd = computeFullHDayDefs(site, false);
    const we = computeFullHDayDefs(site, true);
    shiftLine = `Weekday: ${describe(wd)}. Weekend: ${describe(we)}.`;
  } else {
    const defs = computeShiftDefs(site);
    shiftLine = `${defs.length} shift${defs.length === 1 ? "" : "s"}/day — ${describe(defs)}.`;
  }

  return {
    before: `${shiftLine} Site needs coverage ${cov} day${cov === 1 ? "" : "s"}/week. Suggested headcount from this scenario: `,
    suggested: sug.suggested,
    after: ".",
  };
}

// Local helper — reuses computeShiftDefsForDay via a representative weekday/weekend day-of-week
// (Monday=0, Saturday=5) purely for the summary text's shift-description line.
function computeFullHDayDefs(site: SiteRequirement, weekend: boolean) {
  return computeShiftDefsForDay(site, weekend ? 5 : 0);
}

export { maxConsecutiveDaysFor };

/** #saveRestBtn handler (lines 5141-5148). `restDaysPerWeek` is clamped 0–6; `minRestHours`
 * is NOT clamped (any non-negative-looking number is accepted, matching the original). */
export function applySaveRestRules(config: SiteConfig, ms: MonthState, restDaysPerWeekRaw: number, minRestHoursRaw: number): ConfigActionOutcome {
  const nextConfig = deepClone(config);
  const restDaysPerWeek = Math.max(0, Math.min(6, Number(restDaysPerWeekRaw) || 0));
  const minRestHours = Number(minRestHoursRaw) || 0;
  nextConfig.restRule = { restDaysPerWeek, minRestHours };
  markSiteSetupSaved(nextConfig, "rest");
  const nextMs = appendLog(ms, `Updated rest rules: ${restDaysPerWeek} rest day(s)/week, min ${minRestHours}h rest between shifts.`);
  return { config: nextConfig, ms: nextMs, toast: "Rest rules saved." };
}

// ---------------------------------------------------------------------------
// Add-guard setup gate
// ---------------------------------------------------------------------------

const SETUP_GATE_LABELS = {
  site: "Client Site Requirement",
  rest: "Rest Rules",
  holidays: "Public Holidays",
} as const;

export interface SetupGateState {
  locked: boolean;
  noteText: string;
}

/** renderSetupGate() (lines 3796-3813) — whether "+ Add guard" should be disabled and the
 * warning note under it. */
export function computeSetupGate(cfg: Pick<SiteConfig, "setupSaved" | "guards">): SetupGateState {
  const saved = siteSetupSaved(cfg);
  const missing = (Object.keys(SETUP_GATE_LABELS) as (keyof typeof SETUP_GATE_LABELS)[]).filter((k) => !saved[k]);
  return {
    locked: missing.length > 0,
    noteText: missing.length ? `Save ${missing.map((k) => SETUP_GATE_LABELS[k]).join(", ")} below first before adding guards.` : "",
  };
}
