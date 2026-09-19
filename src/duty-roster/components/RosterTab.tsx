import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MonthState, GenerateMonthResult } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { appendLog, type SlotRef } from "../lockMachine";
import { exportCurrentMonthToExcel } from "../rosterExcelExport";
import { ROSTER_TOKENS } from "../rosterColors";
import RosterStats from "./RosterStats";
import RosterCalendar from "./RosterCalendar";
import RosterGrid from "./RosterGrid";
import FairnessPanel from "./FairnessPanel";
import ConflictsPanel from "./ConflictsPanel";

/**
 * "Roster" tab — composes every piece of index.html's `#view-roster` (lines 333-384) EXCEPT the
 * month-nav (prev/next/label) itself, which is shared, page-level state across every tab that
 * needs it (Roster + Summary Report both do) — see SummaryReportTab.tsx's own doc comment on the
 * same convention. What's left here: the always-visible Stats strip, the Calendar/Grid view
 * toggle + Export to Excel button (both specific to this tab — Summary Report has its own,
 * separate TimeAttendance export and no view toggle), the Calendar or Grid view itself, and the
 * always-visible Fairness/Conflicts pair below.
 *
 * Two separate `{ms, result}` pairs are threaded through on purpose, matching
 * currentMonthStateForRosterDisplay()'s own doc comment in lockMachine.ts: only the Roster
 * SHEET's (grid) own render uses the draft-merged state — Calendar, Stats, Fairness, and
 * Conflicts all read the real, unmerged month state, exactly like every other generateMonth()
 * call elsewhere in this port (Combined Hours, Summary Report, Guard Bank sync, Adjustments).
 * The page shell (Task #22) computes both `result` (from `ms`) and `displayResult` (from
 * `displayMs`, i.e. `useRosterLock().displayMs`) via `generateMonth()` and passes both down.
 */
export interface RosterTabProps {
  y: number;
  m: number;
  config: GenerateMonthConfig;
  /** The real, unmerged month state — feeds Calendar/Stats/Fairness/Conflicts. */
  ms: MonthState;
  result: GenerateMonthResult;
  /** `ms` with any in-progress drag draft merged on top — feeds the Grid view only. */
  displayMs: MonthState;
  displayResult: GenerateMonthResult;
  siteName: string | null;
  monthKey: string;
  locked: boolean;
  canManage: boolean;
  /** session.canEdit — gates the Calendar view's per-day assignment `<select>`s, matching the
   * original's blanket `body.readonly-mode .view select` CSS rule (broader than `canManage`:
   * e.g. dutyStaff can edit the calendar but can't manage the roster lock). The Grid view needs
   * no equivalent wrapping — its own Lock/Discard controls are already gated by `canManage`
   * (hidden outright, matching the original's own `hidden` attribute, not just disabled), and it
   * has no other editable controls. */
  canEdit: boolean;
  pendingCount: number;
  onLock: () => void;
  onUnlock: () => void;
  onDiscard: () => void;
  onDragSwap: (src: SlotRef, dest: SlotRef) => void;
  onPersistMonth: (next: MonthState) => void | Promise<void>;
}

type ViewMode = "calendar" | "grid";

const TOGGLE_BTN = "text-xs font-medium rounded-md px-2.5 py-1.5 border transition-colors";

export default function RosterTab({
  y,
  m,
  config,
  ms,
  result,
  displayMs,
  displayResult,
  siteName,
  monthKey,
  locked,
  canManage,
  canEdit,
  pendingCount,
  onLock,
  onUnlock,
  onDiscard,
  onDragSwap,
  onPersistMonth,
}: RosterTabProps) {
  const { t } = useTranslation();
  // Defaults to the Grid ("Roster sheet") view — matches the day-to-day workflow better than
  // Calendar (drag-to-swap rearranging, at-a-glance shift-letter/post columns), per Ihsan's own
  // preference.
  const [view, setView] = useState<ViewMode>("grid");

  function handleExport() {
    const { logText } = exportCurrentMonthToExcel(y, m, config, ms, result, siteName, monthKey);
    // No success toast — matches the original (see SummaryReportTab.tsx's own Export handler for
    // the same "logged line, no toast" convention) and Excel export's own already-visible
    // browser download as the user-facing confirmation.
    onPersistMonth(appendLog(ms, logText));
  }

  return (
    <div className="flex flex-col gap-4">
      <RosterStats config={config} result={result} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border p-0.5" style={{ borderColor: ROSTER_TOKENS.line }}>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={TOGGLE_BTN}
            style={
              view === "calendar"
                ? { background: ROSTER_TOKENS.accent, color: ROSTER_TOKENS.accentInk, borderColor: ROSTER_TOKENS.accent }
                : { borderColor: "transparent" }
            }
          >
            {t('dutyRoster.rosterTab.calendar')}
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={TOGGLE_BTN}
            style={
              view === "grid"
                ? { background: ROSTER_TOKENS.accent, color: ROSTER_TOKENS.accentInk, borderColor: ROSTER_TOKENS.accent }
                : { borderColor: "transparent" }
            }
          >
            {t('dutyRoster.rosterTab.rosterSheet')}
          </button>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className={TOGGLE_BTN}
          style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface, marginLeft: "auto" }}
        >
          {t('dutyRoster.rosterTab.exportToExcel')}
        </button>
      </div>

      {view === "calendar" ? (
        <fieldset disabled={!canEdit} className="contents border-0 p-0 m-0 min-w-0">
          <RosterCalendar y={y} m={m} config={config} ms={ms} result={result} onPersist={onPersistMonth} />
        </fieldset>
      ) : (
        <RosterGrid
          y={y}
          m={m}
          config={config}
          ms={displayMs}
          result={displayResult}
          locked={locked}
          canManage={canManage}
          pendingCount={pendingCount}
          onLock={onLock}
          onUnlock={onUnlock}
          onDiscard={onDiscard}
          onDragSwap={onDragSwap}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FairnessPanel y={y} m={m} config={config} result={result} />
        <ConflictsPanel config={config} ms={ms} result={result} />
      </div>
    </div>
  );
}
