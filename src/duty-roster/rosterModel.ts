/**
 * Month-state / confirmation accessors, guard resolution, and leave helpers — ported from
 * public/duty-roster/index.html lines ~901-1477.
 *
 * IMPORTANT porting note: the legacy console kept `state.currentSiteId`/`state.canEdit`/
 * `state.isPrivileged`/`state.myRole` etc. as a module-level singleton and had these helpers
 * (`guardById`, `activeGuardsOn`, `canManageRosterLock`, ...) reach into it implicitly. That
 * doesn't translate to React (multiple components, no module-level mutable session). Every
 * helper below takes the config/monthState/session bits it needs as explicit parameters
 * instead — same logic, same output, just no hidden global reads. Callers (hooks/components)
 * are what hold the "current site" / "current session" state now, via React context/props.
 */
import type {
  ConfirmedSummary,
  ExtraGuardRecord,
  Guard,
  LeaveEntry,
  MonthState,
  ResolvedGuard,
  RestRule,
  SiteConfig,
  SiteRequirement,
  SiteSetupSaved,
} from "./types";
import { LEAVE_REASONS, RESERVED_FOR_TEMP } from "./types";

// ---------------------------------------------------------------------------
// id/misc utilities (lines ~901-918)
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** CRITICAL: Firestore snap.data() returns frozen/non-extensible objects — every doc read from
 * Firestore MUST be deep-cloned before any mutation, or mutations silently throw. */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  try {
    if (typeof structuredClone === "function") return structuredClone(obj);
  } catch {
    // fall through to JSON clone
  }
  return JSON.parse(JSON.stringify(obj));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function fmtLogTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Default/sample state builders (lines ~921-983)
// ---------------------------------------------------------------------------

export function defaultSite(): SiteRequirement {
  return {
    pattern: "DN",
    postsU: 1, postsDay: 1, postsNight: 1, postsWd: 1, postsWe: 1,
    postsWdDay: 1, postsWdNight: 1, postsWeDay: 1, postsWeNight: 1,
    shiftsWdDay: [12], shiftsWdNight: [12], shiftsWeDay: [12], shiftsWeNight: [12],
    nightStart: 19, hoursDay: 24, daysWeek: 7, shiftHrs: 12, rosterStart: 7,
    normalHoursPerDay: 8, // Malaysia EA default OT threshold
  };
}

export function sampleGuardNames(): string[] {
  return ["Ahmad Faiz", "Kumaravel Muthu", "Siti Aminah", "Wei Jian Tan", "Nur Hidayah", "Rajesh Kumar"];
}

export function makeSampleConfig(): Omit<SiteConfig, "id" | "name" | "branch"> & { guards: Guard[] } {
  return {
    guards: sampleGuardNames().map((n) => ({ id: newId("g"), name: n, active: true, inactiveFrom: null })),
    site: defaultSite(),
    restRule: { restDaysPerWeek: 1, minRestHours: 12 },
    publicHolidays: [],
    state: null,
    stateHolidayDates: [],
    isSample: true,
    updatedAt: nowIso(),
  } as Omit<SiteConfig, "id" | "name" | "branch"> & { guards: Guard[] };
}

export function emptyMonthState(key: string): MonthState {
  return {
    month: key,
    overrides: {},
    leaves: {},
    log: [],
    tempGuards: {},
    supportGuards: {},
    extraGuards: {},
    confirmed: null,
    confirmedIncoming: null,
    rosterLocked: true,
    draftOverrides: {},
    updatedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Confirmation / permission accessors (lines ~989-1051)
// ---------------------------------------------------------------------------

export function monthConfirmed(ms: MonthState): ConfirmedSummary | null {
  return ms.confirmed || null;
}

export function monthInvoiceConfirmed(ms: MonthState) {
  return ms.invoiceConfirmed || null;
}

/** Session bits every permission check below needs — the React equivalent of reading
 * `state.canEdit`/`state.isPrivileged`/`state.myRole` off the legacy singleton. Supplied by
 * whatever hook/context tracks the signed-in user's CRM role for this site. */
export interface RosterSession {
  canEdit: boolean;
  isPrivileged: boolean;
  myRole: string | null;
}

export function canConfirmInvoiceSummary(session: RosterSession): boolean {
  return session.canEdit;
}

export function canConfirmCombinedHours(session: RosterSession): boolean {
  return session.canEdit && (session.isPrivileged || session.myRole === "branchManager");
}

export function revokeConfirmationIfPresent(ms: MonthState): void {
  if (ms.confirmed) {
    ms.confirmed = null;
    ms.confirmedIncoming = null;
  }
  if (ms.invoiceConfirmed) {
    ms.invoiceConfirmed = null;
  }
}

export function monthTempGuards(ms: MonthState) {
  if (!ms.tempGuards) ms.tempGuards = {};
  return ms.tempGuards;
}

export function monthSupportGuards(ms: MonthState) {
  if (!ms.supportGuards) ms.supportGuards = {};
  return ms.supportGuards;
}

export function monthExtraGuards(ms: MonthState) {
  if (!ms.extraGuards) ms.extraGuards = {};
  return ms.extraGuards;
}

export function monthDraftOverrides(ms: MonthState) {
  if (!ms.draftOverrides) ms.draftOverrides = {};
  return ms.draftOverrides;
}

/** Tri-state: `rosterLocked !== false` means locked — i.e. `undefined`/missing (never set) or
 * `true` both count as locked, matching legacy Firestore docs that predate this field. */
export function isRosterLocked(ms: MonthState): boolean {
  return ms.rosterLocked !== false;
}

/** Same branch-level permission tier as canConfirmCombinedHours() — Admin/HQ, or this site's own
 * Branch Manager, can unlock the Roster sheet for drag-to-swap rearranging and lock it back in.
 * Deliberately narrower than canAssignSupportGuard() (which also includes dutyStaff):
 * rearranging the WHOLE roster is a bigger lever than covering one open slot. */
export function canManageRosterLock(session: RosterSession): boolean {
  return session.canEdit && (session.isPrivileged || session.myRole === "branchManager");
}

/** Every Additional Guard (Temporary) entry whose date range covers dateStr and whose shift
 * matches shiftId, in a stable order (object key insertion order) — generateMonth() derives
 * each entry's slot index from this order every run (never persisted), so as long as entries
 * aren't reordered, the same entry always lands at the same slot across renders. */
export function extraGuardEntriesFor(
  monthState: MonthState,
  dateStr: string,
  shiftId: string
): { id: string; guardId: string }[] {
  const eg = monthExtraGuards(monthState);
  return Object.keys(eg)
    .filter((id) => {
      const e: ExtraGuardRecord | undefined = eg[id];
      return e && e.shiftId === shiftId && dateStr >= e.startDate && dateStr <= e.endDate;
    })
    .map((id) => ({ id, guardId: eg[id].guardId }));
}

/** Support guard ids whose override slot still actually points at them this month — same orphan
 * check used by the Support Guard panel and its export, pulled out so the Summary Report (both
 * the on-screen table and its export) can use it too instead of listing every record ever
 * created for the month, including ones no longer assigned. */
export function activeSupportIds(ms: MonthState): string[] {
  const overrideValues = new Set(Object.values(ms.overrides || {}));
  return Object.keys(monthSupportGuards(ms)).filter((id) => overrideValues.has(id));
}

// ---------------------------------------------------------------------------
// Site setup save-gate (lines ~1074-1107)
// ---------------------------------------------------------------------------

/** Whether a site's Client Site Requirement / Rest Rules / Public Holidays have each been
 * explicitly saved at least once since the last edit to that section — gates the "Add guard"
 * button so a brand-new site's basic shape and rules are locked in before anyone starts adding
 * guards against them, and again after any later edit to one of these 3 sections until it's
 * explicitly re-saved (see markSiteSetupDirty()/markSiteSetupSaved()). Deliberately NOT
 * persisted proactively on every keystroke — only written to Firestore when an actual Save
 * button is clicked, or incidentally alongside whatever save call happens next.
 *
 * A site created before this feature existed has no `setupSaved` field at all — treated as
 * already-saved once it already has at least one guard (never retroactively locks out an
 * established site), but starts unsaved, same as brand-new, if it somehow has none yet either. */
export function siteSetupSaved(cfg: Pick<SiteConfig, "setupSaved" | "guards">): SiteSetupSaved {
  if (cfg.setupSaved) return cfg.setupSaved;
  const already = !!(cfg.guards && cfg.guards.length);
  return { site: already, rest: already, holidays: already };
}

export function allSiteSetupSaved(cfg: Pick<SiteConfig, "setupSaved" | "guards">): boolean {
  const s = siteSetupSaved(cfg);
  return !!(s.site && s.rest && s.holidays);
}

/** Marks one section's fields as edited-but-not-yet-saved, re-locking "Add guard" until that
 * section's own Save button is clicked again. Mutates `cfg` in place, same as the original. */
export function markSiteSetupDirty(cfg: SiteConfig, key: keyof SiteSetupSaved): void {
  cfg.setupSaved = Object.assign({}, siteSetupSaved(cfg), { [key]: false });
}

/** Marks one section as saved — call right before persisting it (and the section's real field
 * values) to Firestore. */
export function markSiteSetupSaved(cfg: SiteConfig, key: keyof SiteSetupSaved): void {
  cfg.setupSaved = Object.assign({ site: false, rest: false, holidays: false }, siteSetupSaved(cfg), { [key]: true });
}

// ---------------------------------------------------------------------------
// Guard resolution & leave helpers (lines ~1412-1477)
// ---------------------------------------------------------------------------

/** Resolves a slot's assigned id against the permanent roster first, then falls back to this
 * month's temporary guards, then its support guards — this is what lets every render surface
 * (calendar, grid, Excel export) show a temp/support guard's name automatically, with no
 * separate code path, since they all just call guardName(id). */
export function guardById(config: Pick<SiteConfig, "guards">, ms: MonthState, id: string): ResolvedGuard | null {
  const g = config.guards.find((g) => g.id === id);
  if (g) return g;
  const t = ms.tempGuards && ms.tempGuards[id];
  if (t) return { id, name: t.name, active: true, inactiveFrom: null, isTemp: true, rate: t.rate };
  const s = ms.supportGuards && ms.supportGuards[id];
  if (s) {
    return {
      id,
      name: s.name,
      employeeId: s.employeeId,
      active: true,
      inactiveFrom: null,
      isSupport: true,
      homeSiteId: s.homeSiteId,
      homeSiteName: s.homeSiteName,
      homeGuardId: s.homeGuardId,
    };
  }
  return null;
}

export function guardName(config: Pick<SiteConfig, "guards">, ms: MonthState, id: string): string {
  const g = guardById(config, ms, id);
  if (!g) return "(removed guard)";
  if (g.isTemp) return `${g.name} (Temp)`;
  if (g.isSupport) return `${g.name} (Support — ${g.homeSiteName})`;
  return g.name;
}

export function activeGuardsOn(config: Pick<SiteConfig, "guards">, dateStr: string): Guard[] {
  return config.guards.filter((g) => g.active !== false && (!g.inactiveFrom || dateStr < g.inactiveFrom));
}

/** "Support (Other Site)" marks a guard as temporarily working a shift at a different client
 * site within the branch, rather than actually being away. Excluded on purpose from the
 * MC/Absent/Leave/Unpaid-leave tallies in the payroll summary, so a support day never shows up
 * as an absence on his record here — his vacated slot at THIS site still goes through the normal
 * Replacement flow (temp guard / rest-day guard) exactly like any other leave reason. */
export { LEAVE_REASONS, RESERVED_FOR_TEMP };

/** Leave entries used to be stored as bare guard-id strings; normalize both shapes so older
 * saved months keep working. */
export function leaveEntriesFor(monthState: MonthState, dateStr: string): LeaveEntry[] {
  return (monthState.leaves[dateStr] || []).map((e) => (typeof e === "string" ? { id: e, reason: "Leave" } : e));
}

export function leaveGuardIdsFor(monthState: MonthState, dateStr: string): string[] {
  return leaveEntriesFor(monthState, dateStr).map((e) => e.id);
}

/** For a leave entry that has a replacement on file, resolves who is actually covering the
 * vacated slot right now — read live off monthState.overrides/tempGuards rather than trusting
 * whatever was chosen at the moment the leave was marked, since a Temporary Guard replacement is
 * normally filled in as a separate step afterward, and either replacement can still be changed
 * by hand later via the per-slot dropdown elsewhere in Roster. Works for both replacement modes
 * with the same lookup: for "current guard on rest day" the override already holds the covering
 * guard's own id; for "temporary guard" it holds RESERVED_FOR_TEMP until someone's actually
 * assigned. Returns null when there's nothing to show yet. */
export function coveringGuardNameFor(
  config: Pick<SiteConfig, "guards">,
  monthState: MonthState,
  entry: LeaveEntry
): string | null {
  if (!entry.replacementKey) return null;
  const overrideVal = monthState.overrides[entry.replacementKey];
  if (!overrideVal || overrideVal === RESERVED_FOR_TEMP) return null;
  return guardName(config, monthState, overrideVal);
}

/** Human-readable noun for a leave reason, used in auto-assignment flag text ("covering X's
 * <noun> — normally a rest day"). */
export function leaveNoun(reason: string | undefined): string {
  if (reason === "Absent") return "absence";
  if (reason && reason.toLowerCase().indexOf("medical") !== -1) return "medical leave";
  if (reason === "Unpaid Leave") return "unpaid leave";
  if (reason === "Support (Other Site)") return "supporting another site";
  return "leave";
}

// Re-exported for callers that only need the RestRule shape alongside these helpers.
export type { RestRule };
