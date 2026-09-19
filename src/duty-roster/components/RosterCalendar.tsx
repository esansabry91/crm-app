/**
 * Roster Calendar view — a day-per-cell grid with a live per-slot <select> picker in each
 * occupied slot, ported from public/duty-roster/index.html's renderRosterCalendar() via
 * rosterCalendarData.ts's pure buildCalendarDays()/applyCalendarSlotChange(). Presentational:
 * takes ms/result as props rather than subscribing itself, so a parent page component can share
 * one live useMonthState() subscription between this and <RosterGrid/> instead of each hook
 * running its own.
 *
 * Deliberately NOT lock-gated — see rosterCalendarData.ts's doc comment: every `canEdit` user
 * can change a slot here directly regardless of the Roster Sheet's lock state.
 */
import { useTranslation } from "react-i18next";
import type { GenerateMonthResult, MonthState } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { appendLog } from "../lockMachine";
import { applyCalendarSlotChange, buildCalendarDays } from "../rosterCalendarData";
import { ROSTER_TOKENS } from "../rosterColors";

export interface RosterCalendarProps {
  y: number;
  m: number;
  config: GenerateMonthConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  /** Persists a full next MonthState with the normal (non-suppressed) confirm-revoke path —
   * matches the original's persistMonth() call from this view's own <select> change handler. */
  onPersist: (next: MonthState) => void | Promise<void>;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function RosterCalendar({ y, m, config, ms, result, onPersist }: RosterCalendarProps) {
  const { t } = useTranslation();
  const layout = buildCalendarDays(y, m, config, ms, result, t);

  const handleSlotChange = (overrideKey: string, value: string, logShiftLabel: string) => {
    const outcome = applyCalendarSlotChange(ms, overrideKey, value, logShiftLabel, config);
    const withLog = appendLog(outcome.ms, outcome.logText);
    onPersist(withLog);
  };

  return (
    <div>
      <div className="grid grid-cols-7 gap-2 mb-1.5">
        {WEEKDAY_NAMES.map((w) => (
          <span key={w} className="block text-[11px] uppercase tracking-wide text-center font-semibold" style={{ color: ROSTER_TOKENS.muted }}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: layout.leadingPad }).map((_, i) => (
          <div key={"pad-lead-" + i} className="min-h-[110px] rounded-[10px]" />
        ))}
        {layout.days.map((day) => (
          <div
            key={day.dateStr}
            className="rounded-[10px] border p-2 flex flex-col gap-1.5 min-h-[110px]"
            style={{ background: ROSTER_TOKENS.surface2, borderColor: ROSTER_TOKENS.line }}
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className="font-mono font-semibold text-[12.5px]"
                style={{ color: day.isWeekend ? ROSTER_TOKENS.accent : undefined }}
              >
                {String(day.dayNum).padStart(2, "0")} {day.weekdayShort}
              </span>
              {day.leaveCount > 0 && (
                <span
                  className="text-[9.5px] font-semibold rounded px-1.5 py-px whitespace-nowrap"
                  style={{ background: ROSTER_TOKENS.warnSoft, color: ROSTER_TOKENS.warn }}
                >
                  {t('dutyRoster.rosterCalendar.leaveCount', { count: day.leaveCount })}
                </span>
              )}
            </div>

            {day.leaveLines.map((lv, i) => (
              <div
                key={i}
                className="text-[10.5px] rounded px-1.5 py-0.5"
                style={{ background: ROSTER_TOKENS.warnSoft, color: ROSTER_TOKENS.warn }}
              >
                {lv.text}
              </div>
            ))}

            {!day.covered && <div className="text-[11px]" style={{ color: ROSTER_TOKENS.muted }}>{t('dutyRoster.rosterCalendar.noCoverageNeeded')}</div>}

            {day.slots.map((slot, i) =>
              slot.kind === "readonlyExtraGuard" ? (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-[11px]" style={{ color: ROSTER_TOKENS.muted }}>
                    {slot.shiftLabel}
                  </span>
                  <div
                    className="text-[11.5px] rounded px-1.5 py-1 border"
                    style={{
                      borderColor: slot.flagged ? ROSTER_TOKENS.warn : ROSTER_TOKENS.line,
                      background: slot.flagged ? ROSTER_TOKENS.warnSoft : ROSTER_TOKENS.surface,
                    }}
                    title={slot.title}
                  >
                    {slot.displayText}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-[11px]" style={{ color: ROSTER_TOKENS.muted }}>
                    {slot.shiftLabel}
                  </span>
                  <select
                    className="w-full text-[11.5px] px-1.5 py-1 rounded-md border"
                    style={{
                      borderColor: slot.unfilled ? ROSTER_TOKENS.critical : slot.flagged ? ROSTER_TOKENS.warn : ROSTER_TOKENS.line,
                      color: slot.unfilled ? ROSTER_TOKENS.critical : undefined,
                      background: slot.unfilled ? ROSTER_TOKENS.criticalSoft : slot.flagged ? ROSTER_TOKENS.warnSoft : ROSTER_TOKENS.surface,
                    }}
                    title={slot.title}
                    value={slot.selectValue}
                    onChange={(e) => handleSlotChange(slot.overrideKey, e.target.value, slot.logShiftLabel)}
                  >
                    {slot.options.map((opt) => (
                      <option key={opt.value || "__unfilled__"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            )}
          </div>
        ))}
        {Array.from({ length: layout.trailingPad }).map((_, i) => (
          <div key={"pad-trail-" + i} className="min-h-[110px] rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
