/**
 * Adjustments tab — "Assign a support guard" panel. Ported from renderSupportGuardPanel() (lines
 * 4328-4408) and the #assignSupportBtn handler (line 5346). The cross-site availability lookup
 * itself (computeFreeGuardsAt/otherBranchSites) lives in supportGuardCrossSite.ts; this module is
 * the panel's own table/validation/write logic, same shape as tempGuardPanelData.ts.
 */
import type { SiteConfig, MonthState, SupportGuardRecord, ConflictEntry } from "./types";
import { newId, monthSupportGuards } from "./rosterModel";
import { appendLog } from "./lockMachine";
import { shiftLabelForKey } from "./shiftStructure";

export interface SupportSlotOption {
  key: string; // "date|shiftId|slot"
  label: string;
}

export function buildSupportSlotOptions(conflicts: ConflictEntry[]): SupportSlotOption[] {
  return conflicts.map((c) => ({
    key: `${c.date}|${c.shiftId}|${c.slot}`,
    label: `${c.date} — ${c.shiftLabel}, Slot ${c.slot + 1}`,
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
export function buildSupportGuardRows(config: Pick<SiteConfig, "site">, ms: MonthState): SupportGuardRow[] {
  const sg = monthSupportGuards(ms);
  const rows: SupportGuardRow[] = [];
  Object.keys(sg).forEach((supportId) => {
    const key = Object.keys(ms.overrides).find((k) => ms.overrides[k] === supportId);
    if (!key) return;
    const [date, shiftId, slot] = key.split("|");
    rows.push({
      supportId,
      date,
      shiftSlotLabel: `${shiftLabelForKey(config.site, date, shiftId)}, Slot ${Number(slot) + 1}`,
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
  originGuardEmployeeId: string | null | undefined
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
    toast: `Assigned ${originGuardName} to cover ${date}. His home site (${originSiteName}) was marked automatically.`,
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

export function applyRemoveSupportGuard(ms: MonthState, supportId: string): RemoveSupportGuardOutcome | null {
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
    toast: `Removed ${record.name}.`,
    homeSiteId: record.homeSiteId,
    homeGuardId: record.homeGuardId,
    leaveDateStr: key ? key.split("|")[0] : "",
  };
}
