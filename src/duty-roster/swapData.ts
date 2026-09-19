/**
 * Adjustments tab — "Swap two shifts" panel. Ported from renderSwapControls()/
 * fillShiftSelect()/updateSwapSlotOptions() (lines 4706-4749) and the #swapBtn handler (line
 * 5596). Distinct from the Roster Grid's drag-and-swap (already ported in lockMachine.ts as
 * computeDragSwap(), which this mirrors the resolution technique of) — this is a plain
 * form-based manual swap by date+shift+slot picker, always within the currently-displayed month,
 * and writes `ms.overrides` directly (no lock/draft involved).
 */
import type { TFunction } from "i18next";
import type { SiteConfig, MonthState, GenerateMonthResult } from "./types";
import { computeShiftDefsForDay, postsAt, coverageDaysPerWeek } from "./shiftStructure";
import { dowMon } from "./dateUtils";
import { appendLog } from "./lockMachine";
import { guardName } from "./rosterModel";

/** fillShiftSelect() — shift options for a given date (or Monday=0 if no date picked yet, matching the original's `dm||0` fallback). */
export function shiftOptionsForDate(site: SiteConfig["site"], dateStr: string | null): { id: string; label: string }[] {
  const dm = dateStr ? dowMon(dateStr) : 0;
  return computeShiftDefsForDay(site, dm).map((sd) => ({ id: sd.id, label: sd.label }));
}

/** updateSwapSlotOptions() (lines ~4730-4749). Returns the slot count for a date+shift
 * combination — the caller renders `Slot 1..N` options, or a single disabled "No slots that
 * day" option when this is 0. When `dateStr` is null (no date picked yet), returns 1 as a
 * placeholder so the dropdown shows *something* before a date is chosen, even though it's not
 * semantically meaningful — matches the original's own documented non-fix. Falls back to
 * `shiftDefs[0]` if `shiftId` doesn't match any of that date's shifts (can happen with a stale
 * selection carried over from a different date) — also ported as-is, not "fixed". */
export function swapSlotCount(site: SiteConfig["site"], dateStr: string | null, shiftId: string): number {
  if (!dateStr) return 1;
  const dm = dowMon(dateStr);
  const defs = computeShiftDefsForDay(site, dm);
  const st = defs.find((s) => s.id === shiftId) || defs[0];
  if (!st) return 0;
  if (dm >= coverageDaysPerWeek(site)) return 0;
  return postsAt(site, dm, st.night);
}

export interface SwapSlotRef {
  date: string;
  shiftId: string;
  slot: number;
}

export interface SwapOutcome {
  ms: MonthState;
  toast: string;
}

/** #swapBtn handler (line 5596) — a DIRECT unconditional swap: no validation that the two
 * guards aren't the same person, no rest-hour check, no conflict re-check. `result` must already
 * be generateMonth()'d for the currently-displayed month; the caller is responsible for checking
 * both dates actually fall within it first ("Swap only within the month currently shown. Navigate
 * to that month first." if not — unlike "Mark a guard on leave", this action can NOT target a
 * different month). */
export function applySwap(
  config: Pick<SiteConfig, "guards" | "site">,
  ms: MonthState,
  result: GenerateMonthResult,
  a: SwapSlotRef,
  b: SwapSlotRef,
  t: TFunction
): SwapOutcome {
  const site = config.site;
  const defsA = computeShiftDefsForDay(site, dowMon(a.date));
  const defsB = computeShiftDefsForDay(site, dowMon(b.date));
  const dayA = result.days.find((d) => d.dateStr === a.date);
  const dayB = result.days.find((d) => d.dateStr === b.date);
  const stIdxA = defsA.findIndex((s) => s.id === a.shiftId);
  const stIdxB = defsB.findIndex((s) => s.id === b.shiftId);
  const guardAId = dayA && stIdxA >= 0 ? dayA.assignments[stIdxA][a.slot] : null;
  const guardBId = dayB && stIdxB >= 0 ? dayB.assignments[stIdxB][b.slot] : null;

  const nextOverrides = { ...ms.overrides };
  nextOverrides[`${a.date}|${a.shiftId}|${a.slot}`] = guardBId || null;
  nextOverrides[`${b.date}|${b.shiftId}|${b.slot}`] = guardAId || null;

  const nameA = guardAId ? guardName(config, ms, guardAId) : "unfilled";
  const nameB = guardBId ? guardName(config, ms, guardBId) : "unfilled";
  const nextMs = appendLog(
    { ...ms, overrides: nextOverrides },
    `Swapped ${nameA} (${a.date}, ${a.shiftId} Slot ${a.slot + 1}) with ${nameB} (${b.date}, ${b.shiftId} Slot ${b.slot + 1}).`
  );
  return { ms: nextMs, toast: t("dutyRoster.swapPanel.toastSwapped") };
}
