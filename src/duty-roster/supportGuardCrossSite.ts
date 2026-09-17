/**
 * Adjustments tab — the cross-site "support guard" machinery shared by the "Mark a guard on
 * leave" (support mode), "Assign a support guard", and "Assign an additional guard" (support
 * mode) panels. Ported from public/duty-roster/index.html lines ~4047-4260: otherBranchSites(),
 * guardRestOkForSupportShift(), computeFreeGuardsAt(), fillSupportGuardSelect()/
 * fillLeaveSupportSites()/fillLeaveSupportGuardSelect() (the async guard-availability lookups),
 * and syncHomeSiteSupportLeave() (the best-effort home-site safeguard leave entry).
 *
 * This is the single most complex piece of logic in either tab (per the inventory this was
 * drafted against) because it reaches across sites: a support assignment covers an open slot at
 * THIS site with a guard who is nominally free at ANOTHER site that day, and a safeguard leave
 * entry gets written back at his home site so he doesn't also show up double-booked there.
 *
 * Unlike guardBankSync.ts's fire-and-forget writes, computeFreeGuardsAt() is a live read the UI
 * blocks a dropdown on, so it's exposed as a plain async function the caller awaits directly
 * (a React component wires its own "Checking availability…" state around the call) rather than
 * a fire-and-forget void function.
 */
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Guard, SiteConfig, MonthState, GenerateMonthResult, LeaveEntry } from "./types";
import { generateMonth } from "./schedulingEngine";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { computeShiftDefsForDay } from "./shiftStructure";
import { shiftStartEnd } from "./dateUtils";
import { emptyMonthState, leaveEntriesFor, leaveGuardIdsFor, revokeConfirmationIfPresent } from "./rosterModel";

export interface SitePickerOption {
  id: string;
  name: string;
  branch: string | null;
}

/** otherBranchSites() (lines ~4049-4055) — same-branch sites (excluding this one and archived
 * ones); `[]` when this site has no branch at all. */
export function otherBranchSites(
  sites: Pick<SiteConfig, "id" | "name" | "branch" | "archived">[],
  currentSiteId: string,
  currentBranch: string | null
): SitePickerOption[] {
  if (currentBranch == null) return [];
  return sites
    .filter((s) => s.id !== currentSiteId && s.branch === currentBranch && !s.archived)
    .map((s) => ({ id: s.id, name: s.name, branch: s.branch }));
}

/** guardRestOkForSupportShift() (lines ~4057-4090) — scans the ORIGIN site's own already-
 * generated month result for the guard's closest real shift strictly before/after the support
 * window; `true` immediately if minRestHours is falsy/0. Known limitation ported as-is: only
 * scans the ONE month the support date falls in — an adjacent month's boundary shift isn't seen. */
export function guardRestOkForSupportShift(
  config: Pick<SiteConfig, "site" | "restRule">,
  result: GenerateMonthResult,
  guardId: string,
  supportStartMs: number,
  supportEndMs: number
): boolean {
  const minRestHours = Number(config.restRule.minRestHours) || 0;
  if (!minRestHours) return true;
  const minRestMs = minRestHours * 3600 * 1000;
  let closestBeforeEndMs = -Infinity;
  let closestAfterStartMs = Infinity;

  result.days.forEach((day) => {
    const defs = computeShiftDefsForDay(config.site, day.dm);
    day.assignments.forEach((slots, stIdx) => {
      const sd = defs[stIdx];
      if (!sd) return;
      slots.forEach((gid) => {
        if (gid !== guardId) return;
        const { start, end } = shiftStartEnd(day.dateStr, sd);
        const startMs = start.getTime();
        const endMs = end.getTime();
        if (endMs <= supportStartMs && endMs > closestBeforeEndMs) closestBeforeEndMs = endMs;
        if (startMs >= supportEndMs && startMs < closestAfterStartMs) closestAfterStartMs = startMs;
      });
    });
  });

  if (closestBeforeEndMs !== -Infinity && supportStartMs - closestBeforeEndMs < minRestMs) return false;
  if (closestAfterStartMs !== Infinity && closestAfterStartMs - supportEndMs < minRestMs) return false;
  return true;
}

export interface SupportWindow {
  startMs: number;
  endMs: number;
}

/** computeFreeGuardsAt() (lines ~4092-4130) — async, always live-fetches the origin site's month
 * doc fresh (no cache, matching the original's own one-off `.get()`). `originConfig` is expected
 * to come from whatever the caller already keeps as its site-configs cache (the original reads
 * `state.configsCache[originId]`, already live via an existing listener elsewhere in the app —
 * out of this module's scope to re-fetch). `supportWindow` is omitted for the "Mark a guard on
 * leave" support picker until a shift is actually chosen (mirrors the original letting the guard
 * list populate before rest-hour filtering can apply). */
export async function computeFreeGuardsAt(
  originConfig: GenerateMonthConfig,
  originSiteId: string,
  dateStr: string,
  monthKey: string,
  supportWindow: SupportWindow | null
): Promise<Guard[]> {
  const snap = await getDoc(doc(db, "sites", originSiteId, "months", monthKey));
  const ms: MonthState = snap.exists() ? (snap.data() as MonthState) : emptyMonthState(monthKey);
  const [y, m] = monthKey.split("-").map(Number);
  const result = generateMonth(y, m, originConfig, ms);
  const day = result.days.find((d) => d.dateStr === dateStr);

  const workingIds = new Set<string>();
  day?.assignments.forEach((slots) => slots.forEach((id) => id && workingIds.add(id)));
  const onLeave = new Set(leaveGuardIdsFor(ms, dateStr));

  return originConfig.guards.filter((g) => {
    if (g.active === false) return false;
    if (workingIds.has(g.id)) return false;
    if (onLeave.has(g.id)) return false;
    if (supportWindow && !guardRestOkForSupportShift(originConfig, result, g.id, supportWindow.startMs, supportWindow.endMs)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// syncHomeSiteSupportLeave() (lines ~4260-4327-ish; the auto-written home-site safeguard entry)
// ---------------------------------------------------------------------------

/** syncHomeSiteSupportLeave() — best-effort cross-site write, direct via Firestore (not through
 * the normal persistMonth() path, so callers don't need a useMonthState() subscription open on
 * the home site just to write this one safeguard entry). Swallows all errors (a sibling-site sync
 * failure must never block the assignment that triggered it), matching guardBankSync.ts's own
 * philosophy.
 *
 * `add=true`: writes/updates a leave entry `{id:homeGuardId, reason:"Support (Other Site)",
 * supportShiftEndMs, supportToSiteId, supportToSiteName}` at the home site's month doc for that
 * date. `add=false`: only removes the entry if it STILL has `reason === "Support (Other Site)"`
 * and no `replacementKey` — never touches one a human has since layered a real leave/replacement
 * onto (matches the original's own guard). */
export async function syncHomeSiteSupportLeave(
  homeSiteId: string,
  homeGuardId: string,
  dateStr: string,
  add: boolean,
  supportShiftEndMs?: number,
  destSiteId?: string,
  destSiteName?: string
): Promise<void> {
  try {
    const monthKeyStr = dateStr.slice(0, 7);
    const ref = doc(db, "sites", homeSiteId, "months", monthKeyStr);
    const snap = await getDoc(ref);
    const ms: MonthState = snap.exists() ? (snap.data() as MonthState) : emptyMonthState(monthKeyStr);
    const existing = leaveEntriesFor(ms, dateStr);
    const idx = existing.findIndex((e) => e.id === homeGuardId);

    let nextDay: LeaveEntry[];
    if (add) {
      const entry: LeaveEntry = {
        id: homeGuardId,
        reason: "Support (Other Site)",
        ...(supportShiftEndMs != null ? { supportShiftEndMs } : {}),
        ...(destSiteId ? { supportToSiteId: destSiteId } : {}),
        ...(destSiteName ? { supportToSiteName: destSiteName } : {}),
      };
      nextDay = idx >= 0 ? existing.map((e, i) => (i === idx ? entry : e)) : [...existing, entry];
    } else {
      if (idx < 0 || existing[idx].reason !== "Support (Other Site)" || existing[idx].replacementKey) return;
      nextDay = existing.filter((_, i) => i !== idx);
    }

    const nextLeaves = { ...ms.leaves };
    if (nextDay.length) nextLeaves[dateStr] = nextDay;
    else delete nextLeaves[dateStr];

    const nextMs: MonthState = { ...ms, leaves: nextLeaves };
    revokeConfirmationIfPresent(nextMs);
    await setDoc(ref, nextMs, { merge: false });
  } catch {
    // Best-effort — a home-site sync failure must never block the support assignment/removal
    // that triggered it.
  }
}
