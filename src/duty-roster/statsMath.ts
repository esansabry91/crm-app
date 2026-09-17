/**
 * Roster Sheet stat tiles — ported from public/duty-roster/index.html's renderRosterStats()
 * (lines ~2126-2147), split into a pure data function (this file) that a <RosterStats/>
 * component renders as JSX instead of an innerHTML template string.
 */
import type { GenerateMonthResult } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";

export interface RosterStatTiles {
  activeGuards: number;
  shiftSlotsThisMonth: number;
  unfilledSlots: number;
  unfilledIsCritical: boolean;
  autoAssignedOnRestDay: number;
  autoAssignedIsWarn: boolean;
  fairnessSpread: number;
}

/** Same guard set the roster grid/export and every other per-guard breakdown use: active
 * guards, plus anyone inactive who still picked up a shift this month — result.totalShifts has
 * an entry for EVERY guard ever added to this site, including inactive ones sitting at 0
 * shifts, which would otherwise blow up the fairness spread even though those guards appear
 * nowhere else on this page. */
export function computeRosterStatTiles(config: GenerateMonthConfig, result: GenerateMonthResult): RosterStatTiles {
  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const nGuards = config.guards.filter((g) => g.active !== false).length;
  const nShiftSlots = result.days.reduce((sum, day) => sum + day.assignments.reduce((s, arr) => s + arr.length, 0), 0);
  const nUnfilled = result.conflicts.length;
  const nRestDay = result.flags.filter((f) => f.restDay).length;
  const counts = guards.map((g) => result.totalShifts[g.id] || 0);
  const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
  return {
    activeGuards: nGuards,
    shiftSlotsThisMonth: nShiftSlots,
    unfilledSlots: nUnfilled,
    unfilledIsCritical: nUnfilled > 0,
    autoAssignedOnRestDay: nRestDay,
    autoAssignedIsWarn: nRestDay > 0,
    fairnessSpread: spread,
  };
}
