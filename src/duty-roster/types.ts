/**
 * Duty Roster domain types — ported 1:1 from public/duty-roster/index.html's in-memory shapes
 * and Firestore document schemas (see /tmp/claude-0/-home-claude/duty-roster-inventory.md §1/§3
 * for the exhaustive spec this was drafted against). Field names and nullability intentionally
 * match the legacy vanilla-JS console exactly — this is a faithful port, not a redesign, so no
 * data migration is needed when the React version replaces the iframe.
 */

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** A permanent guard on a site's own roster (`sites/{id}.guards[]`). */
export interface Guard {
  id: string;
  name: string;
  employeeId?: string | null;
  active: boolean;
  /** Date (YYYY-MM-DD) from which this guard is no longer active, or null while still active. */
  inactiveFrom: string | null;
  /** Position name (e.g. "Security Guard", "Leader") — matched against the linked tender's
   * `guardRatePositions` in 'multiple' rate mode. Absent for guards created before per-position
   * rates existed, or on a site with no tender-linked rate config at all. */
  position?: string | null;

  // Guard Bank identity fields — mirrored out (never in) to the top-level `guards` collection by
  // guardBankSync.ts on add/dismiss/reactivate/return-to-pool. See that module's doc comment.
  category?: "local" | "nepal" | string;
  age?: number | null;
  state?: string | null;
  city?: string | null;
  /** "nepal" category only. */
  passportNumber?: string | null;
  /** "nepal" category only. */
  permitExpiryDate?: string | null;
  /** Non-"nepal" categories only. */
  mykadNumber?: string | null;
  /** Non-"nepal" categories only. */
  phoneNumber?: string | null;
}

/** The linked tender's (Active Project's) guard-rate configuration for a site, as read live via
 * subscribeTenderRate() — never snapshotted onto a guard. See guardRate()/supportGuardRate() in
 * rateResolution.ts. */
export interface TenderRateConfig {
  guardRateMode: "same" | "multiple";
  guardRate?: number | null;
  guardRatePositions?: { name: string; rate: number }[];
}

/** Resolved guard-like entity — same shape guardById()/guardName() hand back for any of the
 * three kinds of "guard" a slot can be filled by. Only `id`+`name` are guaranteed; the rest
 * disambiguate which kind this is. */
export interface ResolvedGuard {
  id: string;
  name: string;
  employeeId?: string | null;
  active: boolean;
  inactiveFrom: string | null;
  isTemp?: boolean;
  rate?: number;
  isSupport?: boolean;
  homeSiteId?: string;
  homeSiteName?: string;
  homeGuardId?: string;
}

/** A month-scoped temporary guard record (`monthState.tempGuards[id]`). */
export interface TempGuardRecord {
  name: string;
  rate?: number;
}

/** A month-scoped support-guard record — a guard borrowed from another branch site for the
 * month (`monthState.supportGuards[id]`). */
export interface SupportGuardRecord {
  homeSiteId: string;
  homeSiteName: string;
  homeGuardId: string;
  name: string;
  employeeId?: string | null;
  createdAt: string;
}

/** An "Additional Guard (Temporary)" billing-only entry — appended after normal slots, billed
 * separately, never counted in normal totals (`monthState.extraGuards[id]`). */
export interface ExtraGuardRecord {
  guardId: string;
  shiftId: string;
  startDate: string;
  endDate: string;
}

// ---------------------------------------------------------------------------
// Client Site Requirement (the "site" sub-object on the site config doc)
// ---------------------------------------------------------------------------

export type ShiftPattern = "U" | "DN" | "WW" | "FULL" | "FULLH";

export interface SiteRequirement {
  pattern: ShiftPattern;
  // "U" (uniform) pattern
  postsU: number;
  // "DN" (day/night) pattern
  postsDay: number;
  postsNight: number;
  // "WW" (weekday/weekend) pattern
  postsWd: number;
  postsWe: number;
  // "FULL" (weekday/weekend x day/night) pattern
  postsWdDay: number;
  postsWdNight: number;
  postsWeDay: number;
  postsWeNight: number;
  // "FULLH" (per-day-varying custom shift hours) pattern — each list is an array of shift
  // lengths (hours) run back-to-back starting at rosterStart (day) / nightStart (night).
  shiftsWdDay: number[];
  shiftsWdNight: number[];
  shiftsWeDay: number[];
  shiftsWeNight: number[];
  nightStart: number; // hour of day (0-23) the FULLH night block starts
  hoursDay: number; // total coverage hours/day, used with shiftHrs to derive shift count (non-FULLH patterns)
  daysWeek: number; // coverage days per week (0-7)
  shiftHrs: number; // length of each shift, hours (non-FULLH patterns)
  rosterStart: number; // hour of day (0-23) the first/day shift starts
  normalHoursPerDay: number; // Malaysia EA default OT threshold, defaults to 8
}

export interface ShiftDef {
  id: string;
  idx: number;
  label: string;
  startHour: number;
  hours: number;
  night: boolean;
}

// ---------------------------------------------------------------------------
// Site config doc — sites/{id}
// ---------------------------------------------------------------------------

export interface RestRule {
  restDaysPerWeek: number;
  minRestHours: number;
}

export interface SiteSetupSaved {
  site: boolean;
  rest: boolean;
  holidays: boolean;
}

export interface SiteConfig {
  id: string;
  name: string;
  branch: string | null;
  tenderId?: string | null;
  clientName?: string | null;
  archived?: boolean;
  createdAt?: string;
  updatedAt: string;
  isSample?: boolean;
  isTestData?: boolean;

  guards: Guard[];
  site: SiteRequirement;
  restRule: RestRule;

  publicHolidays: string[]; // "YYYY-MM-DD"[], includes both auto (state-calendar) and hand-added dates
  state: string | null; // assigned Malaysia state, or null
  stateHolidayDates: string[]; // subset of publicHolidays that came from the state calendar (auto), so they can be swapped/cleared without touching hand-added dates
  holidayNames?: Record<string, string>; // date -> holiday name, populated for state-calendar dates

  setupSaved?: SiteSetupSaved;
}

// ---------------------------------------------------------------------------
// Month-state doc — sites/{id}/months/{YYYY-MM}
// ---------------------------------------------------------------------------

export interface LeaveEntry {
  id: string; // guard id who is on leave
  reason: string; // one of LEAVE_REASONS
  replacementKey?: string; // "dateStr|shiftId|slot" override key holding the covering guard, if a replacement was chosen
  supportShiftEndMs?: number; // for "Support (Other Site)" leave: end-of-shift timestamp at the site being covered, folded into rest-hour math here
}

export interface LogEntry {
  ts: string; // ISO timestamp
  text: string;
}

/** ms.log is trimmed to the most recent N entries on every push — see addLog() in the legacy
 * console (line ~4762). */
export const MAX_LOG_ENTRIES = 200;

export interface ConfirmedSummary {
  by: string;
  at: string;
  manHours?: number;
  amount?: number;
}

export interface ConfirmedMonthSummary {
  manHours: number;
  amount: number;
  byName?: string;
  at?: string;
  /** Man-hours from "Additional Guard (Temporary)" posts this month — billed separately, not
   * included in manHours/amount above. */
  additionalManHours?: number;
}

export interface MonthState {
  month: string; // "YYYY-MM"
  /** "dateStr|shiftId|slot" -> guardId | RESERVED_FOR_TEMP | null ("Unfilled (manual)") */
  overrides: Record<string, string | null>;
  /** dateStr -> LeaveEntry[] (or legacy bare guard-id strings, normalized on read) */
  leaves: Record<string, Array<LeaveEntry | string>>;
  log: LogEntry[];
  tempGuards: Record<string, TempGuardRecord>;
  supportGuards: Record<string, SupportGuardRecord>;
  extraGuards: Record<string, ExtraGuardRecord>;
  confirmed: ConfirmedSummary | null; // Combined Hours confirmation
  confirmedIncoming: unknown | null;
  invoiceConfirmed?: ConfirmedMonthSummary | null; // plain Summary Report "Confirm for invoicing"
  rosterLocked: boolean | undefined; // tri-state: `!== false` means locked (undefined/true = locked)
  draftOverrides: Record<string, string | null>;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Scheduling engine output
// ---------------------------------------------------------------------------

export interface DayAssignments {
  dateStr: string;
  y: number;
  m: number;
  d: number;
  dm: number; // Monday=0..Sunday=6
  covered: boolean;
  assignments: (string | null)[][]; // per shiftDef index -> per slot -> guardId | null
}

export interface ConflictEntry {
  date: string;
  shiftId: string;
  shiftLabel: string;
  slot: number;
}

export interface FlagEntry {
  date: string;
  shiftId: string;
  shiftLabel: string;
  slot: number;
  guardId: string;
  reason: string;
  restDay?: boolean;
  coveringLeave?: boolean;
  extraGuard?: boolean;
}

export interface GenerateMonthResult {
  days: DayAssignments[];
  totalShifts: Record<string, number>;
  conflicts: ConflictEntry[];
  flags: FlagEntry[];
  extraGuardHours: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEAVE_REASONS = [
  "Leave",
  "Absent",
  "Medical leave (MC)",
  "Unpaid Leave",
  "Support (Other Site)",
] as const;

export type LeaveReason = (typeof LEAVE_REASONS)[number];

/** Sentinel override value meaning "keep this slot a genuine conflict — don't auto-fill it —
 * until a temporary guard is assigned." A real (truthy) string, deliberately distinct from a
 * plain `null`/absent override (which falls through to auto-pick). */
export const RESERVED_FOR_TEMP = "__reserved_temp__";
