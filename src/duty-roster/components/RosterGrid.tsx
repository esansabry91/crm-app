/**
 * Roster Sheet ("grid") view — a dense guards-by-days matrix with drag-to-swap, ported from
 * public/duty-roster/index.html's renderRosterGrid() + initRosterDragToSwap() (lines ~2300-2440,
 * 5663-5710) via rosterGridData.ts's pure buildGridData()/buildGridLegend(). Presentational:
 * takes `result` (already draft-merged when unlocked — see currentMonthStateForRosterDisplay())
 * and lock/session bits as props, driven by a parent that composes this with useRosterLock().
 *
 * Drag-and-drop: the original delegated dragstart/dragover/drop listeners on the table body
 * (#gridBody) rather than attaching one per cell, since the whole body gets replaced via
 * innerHTML on every render(). React doesn't need that trick — each draggable <td> gets its own
 * handlers directly, which is the idiomatic React equivalent and behaves identically (drag a
 * source cell, drop it on a destination cell, same-cell drops are a no-op — handled in
 * lockMachine.ts's computeDragSwap()).
 */
import { useState } from "react";
import type { GenerateMonthResult, MonthState } from "../types";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { buildGridData, type GridCell } from "../rosterGridData";
import { shiftColorFor, shiftLetterFor } from "../rosterColors";
import { ROSTER_TOKENS } from "../rosterColors";
import type { SlotRef } from "../lockMachine";

export interface RosterGridProps {
  y: number;
  m: number;
  config: GenerateMonthConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  locked: boolean;
  canManage: boolean;
  pendingCount: number;
  onLock: () => void;
  onUnlock: () => void;
  onDiscard: () => void;
  onDragSwap: (src: SlotRef, dest: SlotRef) => void;
}

export default function RosterGrid({
  y,
  m,
  config,
  ms,
  result,
  locked,
  canManage,
  pendingCount,
  onLock,
  onUnlock,
  onDiscard,
  onDragSwap,
}: RosterGridProps) {
  const dragEnabled = canManage && !locked;
  const data = buildGridData(y, m, config, ms, result, dragEnabled);
  const [dragSrc, setDragSrc] = useState<SlotRef | null>(null);

  const cellRef = (dateStr: string, cell: GridCell): SlotRef | null =>
    cell.kind === "assigned" ? { date: dateStr, shiftId: cell.shiftId, slot: cell.slot } : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-medium rounded-full px-2.5 py-1"
            style={{
              background: locked ? ROSTER_TOKENS.accentSoft : ROSTER_TOKENS.warnSoft,
              color: locked ? ROSTER_TOKENS.accent : ROSTER_TOKENS.warn,
            }}
          >
            {locked ? "🔒 Locked" : `🔓 Unlocked${pendingCount ? ` — ${pendingCount} pending change${pendingCount === 1 ? "" : "s"}` : " — rearranging"}`}
          </span>
          {!locked && canManage && (
            <span className="text-xs" style={{ color: ROSTER_TOKENS.muted }}>
              Drag a tile onto another to swap, then Lock roster to apply.
            </span>
          )}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            {!locked && pendingCount > 0 && (
              <button
                type="button"
                onClick={onDiscard}
                className="text-xs font-medium rounded-md px-2.5 py-1.5 border"
                style={{ borderColor: ROSTER_TOKENS.critical, color: ROSTER_TOKENS.critical }}
              >
                Discard changes
              </button>
            )}
            <button
              type="button"
              onClick={locked ? onUnlock : onLock}
              className="text-xs font-medium rounded-md px-2.5 py-1.5 border"
              style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface }}
            >
              {locked ? "Unlock to rearrange" : "Lock roster"}
            </button>
          </div>
        )}
      </div>

      <p className="text-sm font-medium mb-2">{data.titleText}</p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
        {data.legend.length ? (
          data.legend.map((entry, i) => {
            const color = shiftColorFor(entry.shiftIdx);
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color.bg }} />
                <span style={{ color: ROSTER_TOKENS.muted }}>
                  Shift {shiftLetterFor(entry.shiftIdx)} ({entry.label}){entry.tag ? ` — ${entry.tag}` : ""} {entry.windowText}
                </span>
              </div>
            );
          })
        ) : (
          <span style={{ color: ROSTER_TOKENS.muted }}>No shifts defined — check Client Site Requirement.</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: ROSTER_TOKENS.line, background: ROSTER_TOKENS.surface }}>
        <table className="text-[12px] border-collapse w-full">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-[3] text-left font-semibold px-2 py-1.5"
                style={{ background: ROSTER_TOKENS.surface }}
              >
                Guard
              </th>
              {data.headerDays.map((d) => (
                <th
                  key={d.dateStr}
                  className="px-1.5 py-1.5 font-medium text-center"
                  style={d.isWeekend ? { background: ROSTER_TOKENS.accentSoft, color: ROSTER_TOKENS.accent } : undefined}
                >
                  {d.dayNum} {d.weekdayInitial}
                </th>
              ))}
              <th className="px-2 py-1.5">Shifts</th>
              <th className="px-2 py-1.5">Rest days</th>
            </tr>
          </thead>
          <tbody>
            {!data.rows.length ? (
              <tr>
                <td className="px-2 py-2">—</td>
                <td colSpan={data.headerDays.length + 2} className="px-2 py-2 text-center" style={{ color: ROSTER_TOKENS.muted }}>
                  Add guards to see the roster sheet.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr key={row.guardId}>
                  <td
                    className="sticky left-0 z-[1] text-left font-semibold px-2 py-1.5"
                    style={{ background: ROSTER_TOKENS.surface }}
                  >
                    {row.guardName}
                  </td>
                  {row.cells.map((cell, dayIdx) => {
                    const dateStr = data.headerDays[dayIdx].dateStr;
                    const ref = cellRef(dateStr, cell);
                    if (cell.kind === "off") {
                      return (
                        <td key={dayIdx} className="px-1.5 py-1.5 text-center" style={{ color: ROSTER_TOKENS.muted }}>
                          OFF
                        </td>
                      );
                    }
                    if (cell.kind === "offLeave") {
                      return (
                        <td
                          key={dayIdx}
                          title={cell.title}
                          className="px-1.5 py-1.5 text-center font-bold"
                          style={{
                            color: ROSTER_TOKENS.warn,
                            background: ROSTER_TOKENS.warnSoft,
                            boxShadow: cell.covered ? `inset 0 0 0 2px ${ROSTER_TOKENS.accent}` : undefined,
                          }}
                        >
                          {cell.abbrev}
                        </td>
                      );
                    }
                    const color = shiftColorFor(cell.shiftIdx);
                    return (
                      <td
                        key={dayIdx}
                        title={cell.title}
                        draggable={cell.draggable}
                        onDragStart={() => ref && setDragSrc(ref)}
                        onDragEnd={() => setDragSrc(null)}
                        onDragOver={(e) => {
                          if (dragSrc) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragSrc && ref) onDragSwap(dragSrc, ref);
                          setDragSrc(null);
                        }}
                        className="px-1.5 py-1.5 text-center font-semibold"
                        style={{
                          background: color.bg,
                          color: color.ink,
                          cursor: cell.draggable ? "grab" : undefined,
                          boxShadow: cell.restFlagged ? `inset 0 0 0 2px ${ROSTER_TOKENS.warn}` : undefined,
                        }}
                      >
                        {shiftLetterFor(cell.shiftIdx)} P{cell.slot + 1}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-center font-bold" style={{ background: ROSTER_TOKENS.surface2 }}>
                    {row.totalShifts}
                  </td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ background: ROSTER_TOKENS.surface2 }}>
                    {row.restDays}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs mt-2" style={{ color: ROSTER_TOKENS.muted }}>
        {data.noteText}
      </p>
    </div>
  );
}
