/**
 * Adjustments tab — "Assign an additional guard" panel. Ported from
 * renderAdditionalGuardPanel()/fillAdditionalGuardSupportSelect()/removeAdditionalGuardEntry()
 * (lines 4417-4527) and the #assignAdditionalGuardBtn handler (lines ~4527-4667 area / validated
 * against the live source at commit time). This is the most field-heavy panel — a date-RANGE
 * assignment (not a single slot), billed separately as "Additional Guard (Temporary)".
 */
import type { TFunction } from "i18next";
import type { SiteConfig, MonthState, TempGuardRecord, ExtraGuardRecord } from "./types";
import { newId, nowIso, monthExtraGuards, guardName, revokeConfirmationIfPresent } from "./rosterModel";
import { appendLog } from "./lockMachine";
import { additionalGuardShiftOptions, computeShiftDefsForDay, shiftLabelForKey } from "./shiftStructure";
import { dowMon, nextDateStr, shiftStartEnd } from "./dateUtils";
import { validateTempGuardIdentityFields, type TempGuardIdentityFormValues } from "./tempGuardPanelData";

export type AdditionalGuardSourceMode = "restday" | "temp" | "support";

/** fillAdditionalGuardSupportSelect() (lines 4494-4503) — plain roster filter, NO
 * availability/rest check at all (unlike the single-date support pickers elsewhere — a whole
 * date range can't be checked the same simple way; a real conflict still surfaces afterward as a
 * flag, same as a manual override, per the original's own documented rationale). */
export function additionalGuardSupportGuardOptions(originConfig: Pick<SiteConfig, "guards">) {
  return originConfig.guards.filter((g) => g.active !== false);
}

export interface AdditionalGuardRow {
  id: string;
  dateLabel: string; // single date, or "start to end" if they differ
  shiftLabel: string;
  sourceLabel: string; // translated display text — see dutyRoster.additionalGuardPanel.source*
  name: string;
}

/** Existing-entries table. `shiftOptions` is additionalGuardShiftOptions(site), passed in so the
 * label lookup matches exactly what the form itself offered. */
export function buildAdditionalGuardRows(
  config: Pick<SiteConfig, "guards">,
  ms: MonthState,
  shiftOptions: { id: string; label: string }[],
  t: TFunction
): AdditionalGuardRow[] {
  const eg = monthExtraGuards(ms);
  const sourceLabels: Record<AdditionalGuardSourceMode, AdditionalGuardRow["sourceLabel"]> = {
    temp: t("dutyRoster.additionalGuardPanel.sourceTemporary"),
    support: t("dutyRoster.additionalGuardPanel.sourceSupport"),
    restday: t("dutyRoster.additionalGuardPanel.sourceRestDay"),
  };
  return Object.keys(eg).map((id) => {
    const entry = eg[id];
    const shiftLabel = shiftOptions.find((s) => s.id === entry.shiftId)?.label || entry.shiftId;
    const name = guardName(config, ms, entry.guardId);
    return {
      id,
      dateLabel: entry.startDate === entry.endDate ? entry.startDate : `${entry.startDate} to ${entry.endDate}`,
      shiftLabel,
      sourceLabel: sourceLabels[entry.sourceMode],
      name,
    };
  });
}

export function removeAdditionalGuardConfirmMessage(name: string, t: TFunction): string {
  return t("dutyRoster.additionalGuardPanel.confirmRemoveMessage", { name });
}

export interface RemoveAdditionalGuardOutcome {
  ms: MonthState;
  toast: string;
  /** Present only when the removed entry was "support" mode — caller should best-effort call
   * syncHomeSiteSupportLeave(homeSiteId, homeGuardId, d, false) for every date in [startDate,
   * endDate], matching the original's per-day cleanup loop. */
  supportCleanup?: { homeSiteId: string; homeGuardId: string; startDate: string; endDate: string };
}

/** removeAdditionalGuardEntry() (lines 4508-4527). */
export function applyRemoveAdditionalGuard(config: Pick<SiteConfig, "guards">, ms: MonthState, id: string, t: TFunction): RemoveAdditionalGuardOutcome | null {
  const eg = monthExtraGuards(ms);
  const entry = eg[id];
  if (!entry) return null;
  const name = guardName(config, ms, entry.guardId);

  const nextEg = { ...eg };
  delete nextEg[id];
  const nextTg = { ...ms.tempGuards };
  const nextSg = { ...ms.supportGuards };
  let supportCleanup: RemoveAdditionalGuardOutcome["supportCleanup"];

  if (entry.sourceMode === "temp") {
    delete nextTg[entry.guardId];
  } else if (entry.sourceMode === "support") {
    const sg = nextSg[entry.guardId];
    delete nextSg[entry.guardId];
    if (sg) supportCleanup = { homeSiteId: sg.homeSiteId, homeGuardId: sg.homeGuardId, startDate: entry.startDate, endDate: entry.endDate };
  }

  const nextMs: MonthState = { ...ms, extraGuards: nextEg, tempGuards: nextTg, supportGuards: nextSg };
  revokeConfirmationIfPresent(nextMs);
  // Log text (appendLog) stays in English forever, per the confirmed scope decision.
  const logged = appendLog(nextMs, `Removed additional guard ${name} (${entry.startDate} to ${entry.endDate}).`);
  return { ms: logged, toast: t("dutyRoster.common.toastRemovedName", { name }), supportCleanup };
}

/** Enumerates every date string in [homeSiteId's cleanup range] — shared helper for both the
 * remove path (above) and the assign path (below)'s per-day support-leave loop. */
export function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let d = startDate;
  while (d <= endDate) {
    out.push(d);
    d = nextDateStr(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// #assignAdditionalGuardBtn (validation + write)
// ---------------------------------------------------------------------------

export interface AdditionalGuardCommonFields {
  shiftId: string;
  startDate: string;
  endDate: string;
}

/** Validation steps 1-4 (shift/dates), shared by every source mode. `monthKey` is the
 * currently-open month ("YYYY-MM") both dates must fall within — the original clamps the
 * date inputs' min/max to it AND re-validates at submit. */
export function validateAdditionalGuardDates(fields: AdditionalGuardCommonFields, monthKey: string, t: TFunction): { error: string } | null {
  if (!fields.shiftId) return { error: t("dutyRoster.additionalGuardPanel.errorPickShift") };
  if (!fields.startDate || !fields.endDate) return { error: t("dutyRoster.additionalGuardPanel.errorPickDates") };
  if (fields.endDate < fields.startDate) return { error: t("dutyRoster.additionalGuardPanel.errorEndBeforeStart") };
  const [y, m] = monthKey.split("-").map(Number);
  const minDate = `${monthKey}-01`;
  const maxDate = `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  if (fields.startDate < minDate || fields.startDate > maxDate || fields.endDate < minDate || fields.endDate > maxDate) {
    return { error: t("dutyRoster.additionalGuardPanel.errorDatesOutOfMonth") };
  }
  return null;
}

export type AdditionalGuardSourceChoice =
  | { mode: "restday"; guardId: string }
  | { mode: "temp"; form: TempGuardIdentityFormValues }
  | {
      mode: "support";
      originSiteId: string;
      originSiteName: string;
      originGuardId: string;
      originGuardName: string;
      originGuardEmployeeId?: string | null;
    };

export interface AssignAdditionalGuardOutcome {
  ms: MonthState;
  toast: string;
  entryId: string;
  entry: ExtraGuardRecord;
  /** Present for "temp" mode — caller should follow up with
   * syncBufferGuardOnAssign(tempRecord, siteMeta, isTestData). */
  tempRecord?: TempGuardRecord;
  /** Present for "support" mode — caller should best-effort call syncHomeSiteSupportLeave()
   * once per date in [startDate, endDate], SKIPPING any date the destination shift doesn't
   * actually run on that day (FULLH can have 0 posts for a category on a given day-of-week) —
   * `datesNeedingSync` is pre-filtered to exactly the dates that need the call, each paired with
   * that day's own shift-end ms (recomputed per day, matching the original, since FULLH's day/
   * night hours can differ weekday vs weekend). */
  supportSync?: {
    homeSiteId: string;
    homeGuardId: string;
    datesNeedingSync: { date: string; shiftEndMs: number }[];
  };
}

/** #assignAdditionalGuardBtn's mode-specific validation + write (steps 5-8 and the final commit).
 * Call only after validateAdditionalGuardDates() returns null. For "support" mode, `canAssign`
 * must be checked by the caller first (silent no-op if false, matching the original's defensive
 * guard — not surfaced as an error here). */
export function applyAssignAdditionalGuard(
  config: Pick<SiteConfig, "guards" | "site">,
  ms: MonthState,
  fields: AdditionalGuardCommonFields,
  choice: AdditionalGuardSourceChoice,
  t: TFunction
): { error: string } | AssignAdditionalGuardOutcome {
  let guardId: string;
  let name: string;
  let tempRecord: TempGuardRecord | undefined;
  let nextMs: MonthState = ms;

  if (choice.mode === "restday") {
    if (!choice.guardId) return { error: t("dutyRoster.additionalGuardPanel.errorPickGuard") };
    guardId = choice.guardId;
    name = guardName(config, ms, choice.guardId);
  } else if (choice.mode === "temp") {
    const validated = validateTempGuardIdentityFields(choice.form, t);
    if ("error" in validated) return validated;
    const tempId = newId("temp");
    tempRecord = validated.record;
    guardId = tempId;
    name = validated.record.name;
    nextMs = { ...ms, tempGuards: { ...ms.tempGuards, [tempId]: validated.record } };
  } else {
    guardId = newId("sup");
    name = choice.originGuardName;
    nextMs = {
      ...ms,
      supportGuards: {
        ...ms.supportGuards,
        [guardId]: {
          homeSiteId: choice.originSiteId,
          homeSiteName: choice.originSiteName,
          homeGuardId: choice.originGuardId,
          name: choice.originGuardName,
          employeeId: choice.originGuardEmployeeId ?? null,
          createdAt: nowIso(),
        },
      },
    };
  }

  const entryId = newId("addlguard");
  const entry: ExtraGuardRecord = {
    shiftId: fields.shiftId,
    startDate: fields.startDate,
    endDate: fields.endDate,
    sourceMode: choice.mode,
    guardId,
    createdAt: nowIso(),
  };
  nextMs = { ...nextMs, extraGuards: { ...monthExtraGuards(nextMs), [entryId]: entry } };
  revokeConfirmationIfPresent(nextMs);

  const label = shiftLabelForKey(config.site, fields.startDate, fields.shiftId);
  // Log text (appendLog) stays in English forever, per the confirmed scope decision.
  nextMs = appendLog(nextMs, `Assigned additional guard ${name} to ${label} from ${fields.startDate} to ${fields.endDate}.`);

  let supportSync: AssignAdditionalGuardOutcome["supportSync"];
  if (choice.mode === "support") {
    const datesNeedingSync: { date: string; shiftEndMs: number }[] = [];
    dateRange(fields.startDate, fields.endDate).forEach((d) => {
      const defs = computeShiftDefsForDay(config.site, dowMon(d));
      const destShift = defs.find((s) => s.id === fields.shiftId);
      if (!destShift) return; // that shift doesn't run this particular day — silently skipped
      datesNeedingSync.push({ date: d, shiftEndMs: shiftStartEnd(d, destShift).end.getTime() });
    });
    supportSync = { homeSiteId: choice.originSiteId, homeGuardId: choice.originGuardId, datesNeedingSync };
  }

  return {
    ms: nextMs,
    toast: t("dutyRoster.additionalGuardPanel.toastAssigned", { name, start: fields.startDate, end: fields.endDate }),
    entryId,
    entry,
    tempRecord,
    supportSync,
  };
}


export { additionalGuardShiftOptions };
