/**
 * "Unfilled & flagged shifts" panel — ported from public/duty-roster/index.html's
 * renderConflicts() (lines ~3551-3559).
 */
import type { MonthState, GenerateMonthResult } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { guardName } from "./rosterModel";

export interface ConflictItem {
  /** Prefix text before the (originally bolded) shift label. */
  before: string;
  /** The shift label — bolded in the original via <strong>. */
  shiftLabel: string;
  /** Suffix text after the shift label. */
  after: string;
}

export function buildConflictItems(config: GenerateMonthConfig, ms: MonthState, result: GenerateMonthResult): ConflictItem[] {
  const items: ConflictItem[] = [];
  result.conflicts.forEach((c) => {
    items.push({ before: "No eligible guard for ", shiftLabel: c.shiftLabel, after: ` slot ${c.slot + 1} on ${c.date}.` });
  });
  result.flags.forEach((f) => {
    items.push({
      before: `${guardName(config, ms, f.guardId)} on `,
      shiftLabel: f.shiftLabel,
      after: ` slot ${f.slot + 1}, ${f.date}: ${f.reason}.`,
    });
  });
  return items;
}
