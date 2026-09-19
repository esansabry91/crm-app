/**
 * Adjustments tab — "Mark a guard on leave" panel + the leave table. Ported from
 * findGuardSlotOnDate()/restingGuardsOn()/updateLeaveReplacementUI() (lines 3829-3919),
 * renderLeaveTable() + its pills (lines 4648-4706), and the #addLeaveBtn/Clear handlers
 * (lines 5193-5280).
 *
 * Everything here is pure and single-site: it takes an already-resolved GenerateMonthResult for
 * the TARGET date's month (the caller — a hook — is responsible for "which month is this date
 * in, load/cache it if it's not the one on screen" via its own equivalent of
 * ensureMonthLoadedForDate(), then running generateMonth() against it, matching the original).
 * The "support" replacement mode additionally needs a cross-site guard lookup + a best-effort
 * write to the guard's home site — that part lives in supportGuardCrossSite.ts and is composed
 * in by the caller, not here.
 */
import type { TFunction } from "i18next";
import type { Guard, SiteConfig, MonthState, LeaveEntry, DayAssignments, GenerateMonthResult, ResolvedGuard } from "./types";
import { RESERVED_FOR_TEMP } from "./types";
import { activeGuardsOn, guardName, leaveEntriesFor, leaveGuardIdsFor, guardById } from "./rosterModel";
import { appendLog } from "./lockMachine";
import { computeShiftDefsForDay } from "./shiftStructure";

/** Maps a raw LEAVE_REASONS value to its translation-key segment. Not run through the generic
 * labelToKey() helper (used elsewhere for Pipeline stages / DISMISS_REASONS) because two of these
 * reasons carry parenthesised text ("Medical leave (MC)", "Support (Other Site)") that would
 * produce an ugly/inconsistent key under that transform — an explicit map is clearer here. */
const LEAVE_REASON_KEYS: Record<string, string> = {
  Leave: "leave",
  Absent: "absent",
  "Medical leave (MC)": "medicalLeave",
  "Unpaid Leave": "unpaidLeave",
  "Support (Other Site)": "supportOtherSite",
};

/** Display-translation key for a stored LEAVE_REASONS value — used for both the reason dropdown/
 * table pill (dutyRoster.leaveReasons.*) and the log/toast verb-phrase (dutyRoster.leavePhrase.*).
 * The stored data value itself stays in English, matching the DISMISS_REASONS pattern. */
export function leaveReasonKey(reason: string): string {
  return LEAVE_REASON_KEYS[reason] || reason;
}

export interface GuardSlotInfo {
  shiftId: string;
  shiftLabel: string;
  slot: number;
}

/** findGuardSlotOnDate() (lines 3829-3846), given an already-generated result for the date's
 * month. Returns null if the guard has no shift that day (resting/inactive/on leave already/
 * etc.). */
export function findGuardSlotOnDate(
  config: Pick<SiteConfig, "site">,
  result: GenerateMonthResult,
  guardId: string,
  dateStr: string
): GuardSlotInfo | null {
  const day = result.days.find((d) => d.dateStr === dateStr);
  if (!day) return null;
  const defs = computeShiftDefsForDay(config.site, day.dm);
  for (let stIdx = 0; stIdx < day.assignments.length; stIdx++) {
    const slots = day.assignments[stIdx];
    for (let slot = 0; slot < slots.length; slot++) {
      if (slots[slot] === guardId) {
        const sd = defs[stIdx];
        return { shiftId: sd ? sd.id : "shift" + stIdx, shiftLabel: sd ? sd.label : "shift" + stIdx, slot };
      }
    }
  }
  return null;
}

/** restingGuardsOn() (lines 3850-3856) — active guards not already working ANY shift that day
 * and not on leave that day, excluding the guard being covered for. */
export function restingGuardsOn(
  config: Pick<SiteConfig, "guards">,
  ms: MonthState,
  dateStr: string,
  excludeGuardId: string,
  day: DayAssignments
): Guard[] {
  const working = new Set<string>();
  day.assignments.forEach((slots) => slots.forEach((id) => id && working.add(id)));
  const onLeave = new Set(leaveGuardIdsFor(ms, dateStr));
  return activeGuardsOn(config, dateStr).filter((g) => g.id !== excludeGuardId && !working.has(g.id) && !onLeave.has(g.id));
}

/** fillGuardSelect() (line 4637) as a pure list builder — every active guard, for #leaveGuard and
 * #addlGuardRestdaySelect. */
export function activeGuardOptions(config: Pick<SiteConfig, "guards">): Guard[] {
  return config.guards.filter((g) => g.active !== false);
}

export type LeaveReplacementMode = "" | "temp" | "restday" | "support";

/** updateLeaveReplacementUI()'s note text (lines 3866-3919), minus the async support-mode
 * sub-fetch (fillLeaveSupportSites/fillLeaveSupportGuardSelect — cross-site, composed by the
 * caller). `restingCount` is `restingGuardsOn(...).length`, already computed by the caller since
 * it needs `day` from the same generateMonth() result. */
export function leaveReplacementNote(
  config: Pick<SiteConfig, "guards">,
  ms: MonthState,
  guardId: string,
  dateStr: string,
  slotInfo: GuardSlotInfo | null,
  mode: LeaveReplacementMode,
  restingCount: number,
  t: TFunction
): string {
  const name = guardName(config, ms, guardId);
  if (!slotInfo) return t("dutyRoster.leavePanel.notScheduled", { name, date: dateStr });
  const { shiftLabel, slot } = slotInfo;
  if (mode === "restday") {
    return restingCount > 0
      ? t("dutyRoster.leavePanel.coveringShiftSlot", { shiftLabel, slot: slot + 1, date: dateStr })
      : t("dutyRoster.leavePanel.noGuardsResting", { date: dateStr });
  }
  if (mode === "temp") {
    return t("dutyRoster.leavePanel.slotWillStayOpen", { shiftLabel, slot: slot + 1, date: dateStr });
  }
  if (mode === "support") {
    return t("dutyRoster.leavePanel.coveringWithSupportGuard", { shiftLabel, slot: slot + 1, date: dateStr });
  }
  return t("dutyRoster.leavePanel.scheduledChooseCoverage", { name, shiftLabel, slot: slot + 1, date: dateStr });
}

/** leavePhrase() (inlined in the #addLeaveBtn handler) — the verb-phrase form used in the
 * permanent change-log text ("Marked X ${phrase} for ${date}"). Distinct wording from
 * rosterModel.ts's leaveNoun() (a noun form used in flag text elsewhere) — both are faithful
 * ports of two different original helpers that happen to cover the same reasons.
 *
 * Deliberately kept in English and NOT translated — this only ever feeds the permanent change
 * log (appendLog), which stays in English forever per the confirmed scope decision (translating
 * it would mean old and new entries show in whichever language was active when each was
 * written). Use leavePhraseTranslated() below for any user-facing (toast) text. */
export function leavePhrase(reason: string): string {
  if (reason === "Absent") return "absent";
  if (reason.toLowerCase().includes("medical")) return "on medical leave";
  if (reason === "Unpaid Leave") return "on unpaid leave";
  if (reason === "Support (Other Site)") return "supporting another site";
  return "on leave";
}

/** Translated equivalent of leavePhrase(), for user-facing toast text (never the log). */
export function leavePhraseTranslated(reason: string, t: TFunction): string {
  return t(`dutyRoster.leavePhrase.${leaveReasonKey(reason)}`);
}

// ---------------------------------------------------------------------------
// #addLeaveBtn — writing the leave entry (lines 5193-5280)
// ---------------------------------------------------------------------------

export interface MarkLeaveRestdayChoice {
  mode: "restday";
  coverGuardId: string;
}
export interface MarkLeaveTempChoice {
  mode: "temp";
}
export interface MarkLeaveSupportChoice {
  mode: "support";
  originGuardId: string;
  originGuardName: string;
  originSiteId: string;
  originSiteName: string;
  supportShiftEndMs: number;
}
export type MarkLeaveChoice = MarkLeaveRestdayChoice | MarkLeaveTempChoice | MarkLeaveSupportChoice;

export interface MarkLeaveOutcome {
  ms: MonthState;
  toast: string;
  /** Present only for a "support" choice — the caller should best-effort call
   * syncHomeSiteSupportLeave(originSiteId, originGuardId, dateStr, true, supportShiftEndMs,
   * destSiteId, destSiteName) after persisting, matching the original's un-awaited fire-and-forget. */
  supportSync?: { originSiteId: string; originGuardId: string };
}

/** The write half of #addLeaveBtn — call after resolving `slotInfo` via findGuardSlotOnDate() and
 * (if the guard does have a shift that day) a validated `choice`. Returns `{error}` for every
 * validation failure the original toasts (guard/date presence is the caller's job to check first
 * and no-op silently, matching the original — this function assumes both are present). */
export function applyMarkLeave(
  config: Pick<SiteConfig, "guards">,
  ms: MonthState,
  guardId: string,
  dateStr: string,
  reason: string,
  slotInfo: GuardSlotInfo | null,
  choice: MarkLeaveChoice | null,
  t: TFunction
): MarkLeaveOutcome | { error: string } {
  let replacementKey: string | undefined;
  let replacementMode: LeaveReplacementMode | undefined;
  let replacementGuardId: string | undefined;
  let logSuffix = "";
  let supportSync: MarkLeaveOutcome["supportSync"];
  const nextMs: MonthState = { ...ms, overrides: { ...ms.overrides }, leaves: { ...ms.leaves } };

  if (slotInfo) {
    if (!choice) return { error: t("dutyRoster.leavePanel.errorChooseReplacement") };
    const { shiftId, shiftLabel, slot } = slotInfo;
    replacementKey = `${dateStr}|${shiftId}|${slot}`;

    if (choice.mode === "temp") {
      replacementMode = "temp";
      logSuffix = ` — ${shiftLabel}, Slot ${slot + 1} held open for a temporary guard`;
      nextMs.overrides[replacementKey] = RESERVED_FOR_TEMP;
    } else if (choice.mode === "support") {
      replacementMode = "support";
      replacementGuardId = choice.originGuardId; // caller creates the supportGuards[] record separately and passes its id here via a pre-step; see hook doc.
      logSuffix = ` — ${shiftLabel}, Slot ${slot + 1} covered by ${choice.originGuardName} (support from ${choice.originSiteName})`;
      supportSync = { originSiteId: choice.originSiteId, originGuardId: choice.originGuardId };
    } else {
      if (!choice.coverGuardId) {
        return { error: t("dutyRoster.leavePanel.errorNoRestDayGuard") };
      }
      replacementMode = "restday";
      replacementGuardId = choice.coverGuardId;
      logSuffix = ` — ${shiftLabel}, Slot ${slot + 1} covered by ${guardName(config, ms, choice.coverGuardId)} (on rest day)`;
      nextMs.overrides[replacementKey] = choice.coverGuardId;
    }
  }

  const existing = leaveEntriesFor(nextMs, dateStr);
  const idx = existing.findIndex((e) => e.id === guardId);
  const entry: LeaveEntry = idx >= 0 ? { ...existing[idx] } : { id: guardId, reason };
  entry.reason = reason;
  if (replacementKey && replacementMode) {
    entry.replacementKey = replacementKey;
    entry.replacementMode = replacementMode;
    if (replacementGuardId) entry.replacementGuardId = replacementGuardId;
    else delete entry.replacementGuardId;
  } else {
    delete entry.replacementKey;
    delete entry.replacementMode;
    delete entry.replacementGuardId;
  }

  const dayEntries = idx >= 0 ? existing.map((e, i) => (i === idx ? entry : e)) : [...existing, entry];
  nextMs.leaves[dateStr] = dayEntries;

  const name = guardName(config, ms, guardId);
  // Log text (appendLog) stays in English forever — leavePhrase(), not the translated version.
  const loggedMs = appendLog(nextMs, `Marked ${name} ${leavePhrase(reason)} for ${dateStr}.${logSuffix}`);
  const phrase = leavePhraseTranslated(reason, t);
  const toast =
    choice?.mode === "support"
      ? t("dutyRoster.leavePanel.toastMarkedSupport", { name, phrase, date: dateStr })
      : t("dutyRoster.leavePanel.toastMarked", { name, phrase, date: dateStr });

  return { ms: loggedMs, toast, supportSync };
}

// ---------------------------------------------------------------------------
// Leave table (renderLeaveTable(), lines 4667-4700)
// ---------------------------------------------------------------------------

export interface LeaveReplacementPillInfo {
  text: string;
}

/** leaveReplacementPill() (lines 4648-4657). */
export function leaveReplacementPill(config: Pick<SiteConfig, "guards">, ms: MonthState, e: LeaveEntry, t: TFunction): LeaveReplacementPillInfo | null {
  if (e.replacementMode === "temp") return { text: t("dutyRoster.leavePanel.pillTempGuard") };
  if (e.replacementMode === "restday" && e.replacementGuardId) {
    return { text: t("dutyRoster.leavePanel.pillCoveredBy", { name: guardName(config, ms, e.replacementGuardId) }) };
  }
  if (e.replacementMode === "support" && e.replacementGuardId) {
    const g = guardById(config, ms, e.replacementGuardId) as ResolvedGuard | null;
    if (g) {
      return g.homeSiteName
        ? { text: t("dutyRoster.leavePanel.pillSupportGuardFrom", { name: g.name, site: g.homeSiteName }) }
        : { text: t("dutyRoster.leavePanel.pillSupportGuard", { name: g.name }) };
    }
  }
  return null;
}

/** leaveSupportDestinationPill() (lines 4658-4666) — only meaningful on the auto-written
 * home-site safeguard entry. */
export function leaveSupportDestinationPill(e: LeaveEntry, t: TFunction): LeaveReplacementPillInfo | null {
  return e.supportToSiteName ? { text: t("dutyRoster.leavePanel.destinationPill", { site: e.supportToSiteName }) } : null;
}

export interface LeaveTableCell {
  guardId: string;
  guardName: string;
  reason: string;
  replacementPill: LeaveReplacementPillInfo | null;
  destinationPill: LeaveReplacementPillInfo | null;
}

export interface LeaveTableRow {
  date: string;
  cells: LeaveTableCell[];
}

/** buildLeaveTableRows() — one row per date with any leave entries, sorted ascending. */
export function buildLeaveTableRows(config: Pick<SiteConfig, "guards">, ms: MonthState, t: TFunction): LeaveTableRow[] {
  return Object.keys(ms.leaves)
    .filter((d) => (ms.leaves[d] || []).length > 0)
    .sort()
    .map((date) => ({
      date,
      cells: leaveEntriesFor(ms, date).map((e) => ({
        guardId: e.id,
        guardName: guardName(config, ms, e.id),
        reason: t(`dutyRoster.leaveReasons.${leaveReasonKey(e.reason)}`),
        replacementPill: leaveReplacementPill(config, ms, e, t),
        destinationPill: leaveSupportDestinationPill(e, t),
      })),
    }));
}

export interface ClearLeaveDayOutcome {
  ms: MonthState;
  /** One per entry that had a "support" replacement — caller should best-effort call
   * syncHomeSiteSupportLeave(originSiteId, originGuardId, date, false) for each, matching the
   * original's per-entry cleanup loop. */
  supportSyncsToUndo: { originSiteId: string; originGuardId: string }[];
}

/** "Clear" (lines 4667-4700 tail) — removes ALL leave entries for one date at once, no
 * confirm modal (unlike almost every other destructive action in these two tabs) and —
 * verified against the live source — no toast either (just the change-log line). Only clears
 * an override if it still equals exactly what this leave entry expects (never undoes a later
 * manual reassignment). `supportHomeSiteIds` maps a support-mode entry's `replacementGuardId` (a
 * supportGuards[] key) to its `{homeSiteId, homeGuardId}` — the caller resolves this from
 * `ms.supportGuards` since guardById()'s ResolvedGuard doesn't carry the raw ids this needs. */
export function applyClearLeaveDay(
  ms: MonthState,
  date: string,
  supportHomeSiteIds: Record<string, { homeSiteId: string; homeGuardId: string }>
): ClearLeaveDayOutcome {
  const entries = leaveEntriesFor(ms, date);
  const nextOverrides = { ...ms.overrides };
  const supportSyncsToUndo: ClearLeaveDayOutcome["supportSyncsToUndo"] = [];

  entries.forEach((e) => {
    if (!e.replacementKey) return;
    // Matches the original exactly: `e.replacementGuardId` is compared as-is (possibly
    // `undefined` for "temp" mode's own RESERVED_FOR_TEMP case, handled by the ternary below),
    // never coalesced to `null` — an override value is always a string or `null`, so an
    // `undefined` expectation simply never matches and the override is correctly left alone.
    const expected = e.replacementMode === "temp" ? RESERVED_FOR_TEMP : e.replacementGuardId;
    if (nextOverrides[e.replacementKey] === expected) delete nextOverrides[e.replacementKey];
    if (e.replacementMode === "support" && e.replacementGuardId) {
      const home = supportHomeSiteIds[e.replacementGuardId];
      if (home) supportSyncsToUndo.push({ originSiteId: home.homeSiteId, originGuardId: home.homeGuardId });
    }
  });

  const nextLeaves = { ...ms.leaves };
  delete nextLeaves[date];

  const nextMs = appendLog({ ...ms, overrides: nextOverrides, leaves: nextLeaves }, `Cleared leave entries for ${date}.`);
  return { ms: nextMs, supportSyncsToUndo };
}
