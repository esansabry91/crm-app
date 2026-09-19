/**
 * Roster Calendar view — pure data derivation ported from public/duty-roster/index.html's
 * renderRosterCalendar() (lines ~2148-2286). A <RosterCalendar/> component turns
 * buildCalendarDays()'s output into JSX instead of building DOM nodes by hand; applyCalendarSlotChange()
 * is the pure reducer for a per-slot <select> change (the calendar's inline picker, which unlike
 * the Roster Sheet's drag-to-swap is NOT lock-gated at all — see the inventory's §4.1: every
 * `canEdit` user can edit a calendar slot directly regardless of lock state; only the Roster
 * Sheet grid's drag-and-drop goes through the lock machine).
 */
import type { TFunction } from "i18next";
import type { FlagEntry, GenerateMonthResult, LeaveEntry, MonthState } from "./types";
import { RESERVED_FOR_TEMP } from "./types";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { coveringGuardNameFor, guardById, guardName, leaveEntriesFor } from "./rosterModel";
import { computeShiftDefsForDay, postsAt } from "./shiftStructure";
import { isWeekend, weekdayShort } from "./dateUtils";
import { leaveReasonKey } from "./leaveData";

export const AUTO_ASSIGN_VALUE = "__auto__";
export const UNFILLED_VALUE = "";

export interface CalendarSlotOption {
  value: string;
  label: string;
}

export type CalendarSlotCell =
  | {
      kind: "readonlyExtraGuard";
      shiftLabel: string;
      displayText: string;
      title: string;
      flagged: boolean;
    }
  | {
      kind: "editable";
      overrideKey: string;
      shiftLabel: string;
      /** Bare shift label (no "#N" slot suffix) — matches the original addLog() text exactly. */
      logShiftLabel: string;
      unfilled: boolean;
      flagged: boolean;
      flagReason?: string;
      title?: string;
      options: CalendarSlotOption[];
      selectValue: string;
    };

export interface CalendarDayCell {
  dateStr: string;
  dayNum: number;
  weekdayShort: string;
  isWeekend: boolean;
  covered: boolean;
  leaveLines: { text: string }[];
  leaveCount: number;
  slots: CalendarSlotCell[];
}

export interface CalendarLayout {
  leadingPad: number;
  trailingPad: number;
  days: CalendarDayCell[];
}

export function buildCalendarDays(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  ms: MonthState,
  result: GenerateMonthResult,
  t: TFunction
): CalendarLayout {
  const guardsAll = config.guards;
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();

  const days: CalendarDayCell[] = result.days.map((day) => {
    const wknd = isWeekend(day.y, day.m, day.d);
    const leaveEntriesToday = leaveEntriesFor(ms, day.dateStr);
    const leaveGuards = leaveEntriesToday.map((e) => e.id);

    const leaveLines = leaveEntriesToday.map((lv: LeaveEntry) => {
      const covering = coveringGuardNameFor(config, ms, lv);
      const name = guardName(config, ms, lv.id);
      const reason = t(`dutyRoster.leaveReasons.${leaveReasonKey(lv.reason || "Leave")}`);
      const text = covering
        ? t("dutyRoster.rosterCalendar.leaveLineCovered", { name, reason, covering })
        : t("dutyRoster.rosterCalendar.leaveLineBase", { name, reason });
      return { text };
    });

    const slots: CalendarSlotCell[] = [];
    if (day.covered) {
      const shiftTypes = computeShiftDefsForDay(config.site, day.dm);
      shiftTypes.forEach((st, stIdx) => {
        const slotIds = day.assignments[stIdx];
        if (!slotIds) return;
        const posts = Math.max(0, Math.round(postsAt(config.site, day.dm, st.night)));
        slotIds.forEach((guardId, slotIdx) => {
          const shiftLabel = st.label + (slotIds.length > 1 ? " #" + (slotIdx + 1) : "");

          if (slotIdx >= posts) {
            const flag = findFlag(result.flags, day.dateStr, st.id, slotIdx);
            slots.push({
              kind: "readonlyExtraGuard",
              shiftLabel,
              displayText: guardId ? guardName(config, ms, guardId) : t("dutyRoster.rosterCalendar.unassignedParen"),
              title:
                t("dutyRoster.rosterCalendar.additionalGuardTitle", {
                  panel: t("dutyRoster.additionalGuardPanel.title"),
                  tab: t("dutyRoster.tabs.adjust"),
                }) + (flag ? ` — ${flag.reason}` : ""),
              flagged: !!flag,
            });
            return;
          }

          const overrideKey = day.dateStr + "|" + st.id + "|" + slotIdx;
          const isOverridden = Object.prototype.hasOwnProperty.call(ms.overrides, overrideKey);
          const flagged = findFlag(result.flags, day.dateStr, st.id, slotIdx);

          const options: CalendarSlotOption[] = [
            { value: UNFILLED_VALUE, label: isOverridden ? t("dutyRoster.rosterCalendar.unfilledManual") : t("dutyRoster.rosterCalendar.unfilled") },
            { value: AUTO_ASSIGN_VALUE, label: t("dutyRoster.rosterCalendar.autoAssign") },
            ...guardsAll.map((g) => {
              let label = g.name;
              if (g.active === false || (g.inactiveFrom && day.dateStr >= g.inactiveFrom)) label += ` ${t("dutyRoster.rosterCalendar.inactiveParen")}`;
              else if (leaveGuards.includes(g.id)) label += ` ${t("dutyRoster.rosterCalendar.leaveParen")}`;
              return { value: g.id, label };
            }),
          ];
          // A temporary guard isn't part of the permanent roster, so guardsAll never has an
          // option for it — without this, the <select> can't display it at all.
          if (guardId && !guardsAll.some((g) => g.id === guardId)) {
            options.push({ value: guardId, label: guardName(config, ms, guardId) });
          }

          const selectValue = isOverridden ? guardId || "" : guardId || AUTO_ASSIGN_VALUE;

          slots.push({
            kind: "editable",
            overrideKey,
            shiftLabel,
            logShiftLabel: st.label,
            unfilled: !guardId,
            flagged: !!flagged,
            flagReason: flagged?.reason,
            title: guardId ? (flagged ? `${guardName(config, ms, guardId)} — ${flagged.reason}` : guardName(config, ms, guardId)) : undefined,
            options,
            selectValue,
          });
        });
      });
    }

    return {
      dateStr: day.dateStr,
      dayNum: day.d,
      weekdayShort: weekdayShort(day.y, day.m, day.d),
      isWeekend: wknd,
      covered: day.covered,
      leaveLines,
      leaveCount: leaveGuards.length,
      slots,
    };
  });

  const totalCells = firstWeekday + result.days.length;
  const trailingPad = (7 - (totalCells % 7)) % 7;

  return { leadingPad: firstWeekday, trailingPad, days };
}

function findFlag(flags: FlagEntry[], date: string, shiftId: string, slot: number): FlagEntry | undefined {
  return flags.find((f) => f.date === date && f.shiftId === shiftId && f.slot === slot);
}

export interface CalendarSlotChangeOutcome {
  ms: MonthState;
  logText: string;
}

/** Applies a calendar <select> change to a MonthState — ported from the original's inline
 * `sel.addEventListener("change", ...)` handler. Deliberately does NOT check
 * canManageRosterLock()/isRosterLocked() — the calendar's per-slot editing was never lock-gated
 * in the original, unlike the Roster Sheet's drag-to-swap. The caller should still persist with
 * the NORMAL (non-suppressed) confirm-revoke path — the original calls persistMonth(), not
 * persistDraftChange(), from this handler. */
export function applyCalendarSlotChange(
  ms: MonthState,
  overrideKey: string,
  value: string,
  logShiftLabel: string,
  config: GenerateMonthConfig
): CalendarSlotChangeOutcome {
  const overrides = { ...ms.overrides };
  const [dateStr, , slotStr] = overrideKey.split("|");
  let logGuardText: string;
  if (value === AUTO_ASSIGN_VALUE) {
    delete overrides[overrideKey];
    logGuardText = "auto-assign";
  } else if (value === UNFILLED_VALUE) {
    overrides[overrideKey] = null;
    logGuardText = "unfilled";
  } else {
    overrides[overrideKey] = value;
    logGuardText = guardName(config, ms, value);
  }
  const next: MonthState = { ...ms, overrides };
  const logText = `Set ${logShiftLabel} slot ${Number(slotStr) + 1} on ${dateStr} to ${logGuardText}.`;
  return { ms: next, logText };
}

// Re-exported so callers can recognize the sentinel without importing types.ts separately.
export { RESERVED_FOR_TEMP, guardById };
