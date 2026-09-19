/**
 * Adjustments tab — "Assign a support guard" panel. Ported from renderSupportGuardPanel() (lines
 * 4328-4408) and the #assignSupportBtn handler (line 5346). The cross-site availability lookup
 * itself (computeFreeGuardsAt/otherBranchSites) lives in supportGuardCrossSite.ts; this module is
 * the panel's own table/validation/write logic, same shape as tempGuardPanelData.ts.
 */
import type { TFunction } from "i18next";
import type { SiteConfig, MonthState, SupportGuardRecord, ConflictEntry } from "./types";
import { newId, monthSupportGuards } from "./rosterModel";
import { appendLog } from "./lockMachine";
import { shiftLabelForKey } from "./shiftStructure";

export interface SupportSlotOption {
  key: string; // "date|shiftId|slot"
  label: string;
}

export function buildSupportSlotOptions(conflicts: ConflictEntry[], t: TFunction): SupportSlotOption[] {
  return conflicts.map((c) => ({
    key: `${c.date}|${c.shiftId}|${c.slot}`,
    label: t("dutyRoster.common.dateShiftSlotOption", { date: c.date, shiftLabel: c.shiftLabel, slot: c.slot + 1 }),
  }));
}

export interface SupportGuardRow {
  supportId: string;
  date: string;
  shiftSlotLabel: string;
  name: string;
  fromSite: string;
}

/** Existing support-guard rows — same orphan-key-lookup pattern as buildTempGuardRows(). */
export function buildSupportGuardRows(config: Pick<SiteConfig, "site">, ms: MonthState, t: TFunction): SupportGuardRow[] {
  const sg = monthSupportGuards(ms);
  const rows: SupportGuardRow[] = [];
  Object.keys(sg).forEach((supportId) => {
    const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === supportId);
    if (!key) return;
    const [date, shiftId, slot] = key.split("|");
    rows.push({
      supportId,
      date,
      shiftSlotLabel: t("dutyRoster.common.shiftSlotLabel", { shiftLabel: shiftLabelForKey(config.site, date, shiftId), slot: Number(slot) + 1 }),
      name: sg[supportId].name,
      fromSite: sg[supportId].homeSiteName,
    });
  });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export interface AssignSupportGuardOutcome {
  ms: MonthState;
  toast: string;
  supportId: string;
  record: SupportGuardRecord;
}

/** #assignSupportBtn validation + write (slot/origin-site/guard already resolved by the caller
 * from its own site-configs cache — this function assumes the lookup already succeeded,
 * matching the point where the original's own defensive "Couldn't find that guard" re-lookup
 * would have already failed and returned early). */
export function applyAssignSupportGuard(
  config: Pick<SiteConfig, "site">,
  ms: MonthState,
  slotKey: string,
  originSiteId: string,
  originSiteName: string,
  originGuardId: string,
  originGuardName: string,
  originGuardEmployeeId: string | null | undefined,
  t: TFunction
): AssignSupportGuardOutcome {
  const supportId = newId("sup");
  const record: SupportGuardRecord = {
    homeSiteId: originSiteId,
    homeSiteName: originSiteName,
    homeGuardId: originGuardId,
    name: originGuardName,
    employeeId: originGuardEmployeeId ?? null,
    createdAt: new Date().toISOString(),
  };
  const [date, shiftId, slot] = slotKey.split("|");
  const label = shiftLabelForKey(config.site, date, shiftId);
  // Log text (appendLog) stays in English forever, per the confirmed scope decision.
  const nextMs = appendLog(
    {
      ...ms,
      supportGuards: { ...ms.supportGuards, [supportId]: record },
      overrides: { ...ms.overrides, [slotKey]: supportId },
    },
    `Assigned ${originGuardName} (support from ${originSiteName}) to ${label}, Slot ${Number(slot) + 1} on ${date}.`
  );
  return {
    ms: nextMs,
    toast: t("dutyRoster.supportGuardPanel.toastAssigned", { name: originGuardName, date, site: originSiteName }),
    supportId,
    record,
  };
}

export interface RemoveSupportGuardOutcome {
  ms: MonthState;
  toast: string;
  /** The removed record's home site/guard — caller should best-effort call
   * syncHomeSiteSupportLeave(homeSiteId, homeGuardId, key.split("|")[0], false). */
  homeSiteId: string;
  homeGuardId: string;
  leaveDateStr: string;
}

export function applyRemoveSupportGuard(ms: MonthState, supportId: string, t: TFunction): RemoveSupportGuardOutcome | null {
  const sg = monthSupportGuards(ms);
  const record = sg[supportId];
  if (!record) return null;
  const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === supportId);
  const nextOverrides = { ...ms.overrides };
  if (key) delete nextOverrides[key];
  const nextSg = { ...sg };
  delete nextSg[supportId];
  const nextMs = appendLog({ ...ms, overrides: nextOverrides, supportGuards: nextSg }, `Removed support guard ${record.name}.`);
  return {
    ms: nextMs,
    toast: t("dutyRoster.common.toastRemovedName", { name: record.name }),
    homeSiteId: record.homeSiteId,
    homeGuardId: record.homeGuardId,
    leaveDateStr: key ? key.split("|")[0] : "",
  };
}
