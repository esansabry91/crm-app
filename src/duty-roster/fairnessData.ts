/**
 * "Monthly work-day summary" panel — ported from public/duty-roster/index.html's
 * renderFairness() (lines ~2888-2908).
 */
import type { TFunction } from "i18next";
import type { GenerateMonthResult } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { NORMAL_WORK_DAYS } from "./payrollMath";
import { daysInMonth, monthLabel } from "./dateUtils";

export interface FairnessRow {
  guardId: string;
  guardName: string;
  worked: number;
  normal: number;
  restDays: number;
  /** null renders as "—", matching the original's onRestDay > 0 ? onRestDay : "&mdash;". */
  onRestDay: number | null;
}

export interface FairnessData {
  subtitle: string;
  rows: FairnessRow[];
}

export function buildFairnessData(y: number, m: number, config: GenerateMonthConfig, result: GenerateMonthResult, t: TFunction): FairnessData {
  const nDays = daysInMonth(y, m);
  const subtitle = t("dutyRoster.fairnessPanel.subtitle", { normalWorkDays: NORMAL_WORK_DAYS, month: monthLabel(y, m), days: nDays });

  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);
  const rows: FairnessRow[] = guards.map((g) => {
    const worked = result.totalShifts[g.id] || 0;
    const normal = Math.min(worked, NORMAL_WORK_DAYS);
    const restDays = nDays - worked;
    const onRestDay = Math.max(0, worked - NORMAL_WORK_DAYS);
    return { guardId: g.id, guardName: g.name, worked, normal, restDays, onRestDay: onRestDay > 0 ? onRestDay : null };
  });

  return { subtitle, rows };
}
