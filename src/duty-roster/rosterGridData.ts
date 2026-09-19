/**
 * Roster Sheet (grid) view — pure data derivation ported from public/duty-roster/index.html's
 * renderRosterGrid() (lines ~2300-2440), minus the DOM-writing/lock-bar-element parts (the lock
 * bar's own status pill/buttons are already covered by useRosterLock.ts — locked/canManage/
 * pendingCount map onto exactly what this function read off currentMonthState() for that).
 */
import type { TFunction } from "i18next";
import type { GenerateMonthResult, MonthState } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { coveringGuardNameFor, leaveEntriesFor } from "./rosterModel";
import { computeShiftDefsForDay } from "./shiftStructure";
import { isWeekend, monthLabel, weekdayShort } from "./dateUtils";
import { leaveAbbrev, shiftColorFor, shiftLetterFor } from "./rosterColors";
import { leaveReasonKey } from "./leaveData";
import type { SlotRef } from "./lockMachine";

const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface GridLegendEntry {
  shiftIdx: number;
  label: string;
  windowText: string;
  tag?: "Weekday" | "Weekend";
}

/** Builds the shift-color legend shown above the grid — a site's shift window can differ
 * between weekday/weekend under the FULLH pattern, so both are called out explicitly instead of
 * one (potentially misleading) shared legend line. */
export function buildGridLegend(config: GenerateMonthConfig): GridLegendEntry[] {
  const site = config.site;
  const windowText = (st: { startHour: number; hours: number }) => {
    const endHour = (st.startHour + st.hours) % 24;
    return `${String(st.startHour).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00`;
  };
  if (site.pattern === "FULLH") {
    const wd = computeShiftDefsForDay(site, 0);
    const we = computeShiftDefsForDay(site, 5);
    return [
      ...wd.map((st, i) => ({ shiftIdx: i, label: st.label, windowText: windowText(st), tag: "Weekday" as const })),
      ...we.map((st, i) => ({ shiftIdx: i, label: st.label, windowText: windowText(st), tag: "Weekend" as const })),
    ];
  }
  const shiftDefs = computeShiftDefsForDay(site, 0);
  return shiftDefs.map((st, i) => ({ shiftIdx: i, label: st.label, windowText: windowText(st) }));
}

export type GridCell =
  | { kind: "off" }
  | { kind: "offLeave"; abbrev: string; title: string; covered: boolean }
  | {
      kind: "assigned";
      shiftIdx: number;
      slot: number;
      shiftId: string;
      shiftLabel: string;
      title: string;
      restFlagged: boolean;
      draggable: boolean;
      dateStr: string;
    };

export interface GridRow {
  guardId: string;
  guardName: string;
  cells: GridCell[];
  totalShifts: number;
  restDays: number;
}

export interface GridHeaderDay {
  dateStr: string;
  dayNum: number;
  weekdayInitial: string;
  isWeekend: boolean;
}

export interface GridData {
  titleText: string;
  legend: GridLegendEntry[];
  headerDays: GridHeaderDay[];
  rows: GridRow[];
  noteText: string;
}

/** dragEnabled mirrors the original's `canDrag && !locked` — pass it in from useRosterLock's
 * canManage/locked so this module stays free of session/lock-state concerns of its own. */
export function buildGridData(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  dragEnabled: boolean,
  t: TFunction
): GridData {
  const site = config.site;
  const nDays = result.days.length;
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const titleText = t("dutyRoster.rosterGrid.titleText", { month: monthLabel(y, m), days: nDays, weekday: FULL_DAY_NAMES[firstWeekday] });

  const dayMaps = result.days.map((day) => {
    const map = new Map<string, { stIdx: number; slot: number; flagged: boolean; flagReason: string | null; label: string; shiftId: string }>();
    const shiftDefs = computeShiftDefsForDay(site, day.dm);
    day.assignments.forEach((slots, stIdx) => {
      slots.forEach((guardId, slotIdx) => {
        if (!guardId) return;
        const sd = shiftDefs[stIdx];
        const flag = result.flags.find((f) => f.date === day.dateStr && f.shiftId === (sd ? sd.id : "shift" + stIdx) && f.slot === slotIdx && f.restDay);
        map.set(guardId, {
          stIdx,
          slot: slotIdx,
          flagged: !!flag,
          flagReason: flag ? flag.reason : null,
          label: sd ? sd.label : "",
          shiftId: sd ? sd.id : "shift" + stIdx,
        });
      });
    });
    return map;
  });

  const dayLeaveMaps = result.days.map((day) => {
    const map = new Map<string, ReturnType<typeof leaveEntriesFor>[number]>();
    leaveEntriesFor(ms, day.dateStr).forEach((e) => map.set(e.id, e));
    return map;
  });

  const guards = config.guards.filter((g) => g.active !== false || (result.totalShifts[g.id] || 0) > 0);

  const headerDays: GridHeaderDay[] = result.days.map((day) => ({
    dateStr: day.dateStr,
    dayNum: day.d,
    weekdayInitial: weekdayShort(day.y, day.m, day.d).charAt(0),
    isWeekend: isWeekend(day.y, day.m, day.d),
  }));

  const rows: GridRow[] = guards.map((g) => {
    const cells: GridCell[] = dayMaps.map((map, dayIdx) => {
      const a = map.get(g.id);
      if (!a) {
        const leaveEntry = dayLeaveMaps[dayIdx].get(g.id);
        if (leaveEntry) {
          const leaveReason = leaveEntry.reason || "Leave"; // raw, English — fed to leaveAbbrev() below, which keys off it
          const translatedReason = t(`dutyRoster.leaveReasons.${leaveReasonKey(leaveReason)}`);
          const covering = coveringGuardNameFor(config, ms, leaveEntry);
          const title = covering ? t("dutyRoster.rosterGrid.offLeaveCovered", { reason: translatedReason, covering }) : translatedReason;
          return { kind: "offLeave", abbrev: leaveAbbrev(leaveReason), title, covered: !!covering };
        }
        return { kind: "off" };
      }
      const title =
        t("dutyRoster.rosterGrid.assignedCellTitle", { letter: shiftLetterFor(a.stIdx), label: a.label, post: a.slot + 1 }) +
        (a.flagged ? ` — ${a.flagReason}` : "") +
        (dragEnabled ? ` — ${t("dutyRoster.rosterGrid.dragToSwapTitleSuffix")}` : "");
      return {
        kind: "assigned",
        shiftIdx: a.stIdx,
        slot: a.slot,
        shiftId: a.shiftId,
        shiftLabel: a.label,
        title,
        restFlagged: a.flagged,
        draggable: dragEnabled,
        dateStr: result.days[dayIdx].dateStr,
      };
    });
    const worked = result.totalShifts[g.id] || 0;
    return { guardId: g.id, guardName: g.name, cells, totalShifts: worked, restDays: nDays - worked };
  });

  const totalSlots = result.days.reduce((s, d) => s + d.assignments.reduce((s2, a) => s2 + a.length, 0), 0);
  let noteText: string;
  if (result.conflicts.length > 0) {
    noteText = t("dutyRoster.rosterGrid.shortByConflicts", { count: result.conflicts.length });
  } else {
    const counts = guards.map((g) => result.totalShifts[g.id] || 0);
    const mn = counts.length ? Math.min(...counts) : 0;
    const mx = counts.length ? Math.max(...counts) : 0;
    noteText =
      mn === mx
        ? t("dutyRoster.rosterGrid.coverageMetSame", { total: totalSlots, count: mn })
        : t("dutyRoster.rosterGrid.coverageMetRange", { total: totalSlots, min: mn, max: mx });
  }

  return { titleText, legend: buildGridLegend(config), headerDays, rows, noteText };
}

// Re-exported for the <RosterGrid/> component's drag handlers.
export { shiftColorFor, shiftLetterFor };
export type { SlotRef };
