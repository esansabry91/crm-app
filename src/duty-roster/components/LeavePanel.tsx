import { useMemo, useState } from "react";
import type { SiteConfig, MonthState, GenerateMonthResult } from "../types";
import { LEAVE_REASONS } from "../types";
import {
  activeGuardOptions,
  findGuardSlotOnDate,
  restingGuardsOn,
  leaveReplacementNote,
  applyMarkLeave,
  buildLeaveTableRows,
  applyClearLeaveDay,
  type LeaveReplacementMode,
  type MarkLeaveChoice,
} from "../leaveData";

/**
 * "Mark a guard on leave" panel + leave table (renderLeaveGuardSelect()/updateLeaveReplacementUI()
 * lines 3814-3919, renderLeaveTable() lines 4667-4700, #addLeaveBtn lines 5193-5280).
 *
 * Scoped to the CURRENTLY DISPLAYED month only for now — the original lets a leave be marked
 * on any month via ensureMonthLoadedForDate() (ad-hoc loading/caching a different month's doc);
 * that cross-month capability depends on the page-level Firestore composition being built in
 * Task #22 and is deliberately deferred, matching how this rewrite has consistently kept
 * Firestore-specific concerns out of the presentational layer until that task wires the real
 * hooks together. Support-mode replacement is likewise deferred here — `canAssignSupport`
 * gates it off entirely until supportGuardCrossSite.ts (Task #19 continuation) is wired in.
 */
export interface LeavePanelProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  canAssignSupport: boolean;
  onSave: (ms: MonthState, toast?: string) => void;
}

export default function LeavePanel({ config, ms, result, canAssignSupport, onSave }: LeavePanelProps) {
  const [guardId, setGuardId] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [reason, setReason] = useState<string>(LEAVE_REASONS[0]);
  const [mode, setMode] = useState<LeaveReplacementMode>("");
  const [coverGuardId, setCoverGuardId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const guards = activeGuardOptions(config);
  const day = dateStr ? result.days.find((d) => d.dateStr === dateStr) : undefined;
  const slotInfo = guardId && dateStr ? findGuardSlotOnDate(config, result, guardId, dateStr) : null;
  const resting = useMemo(
    () => (slotInfo && day ? restingGuardsOn(config, ms, dateStr, guardId, day) : []),
    [slotInfo, day, config, ms, dateStr, guardId]
  );
  const note =
    guardId && dateStr ? leaveReplacementNote(config, ms, guardId, dateStr, slotInfo, mode, resting.length) : "";

  const rows = buildLeaveTableRows(config, ms);

  function handleAdd() {
    if (!guardId || !dateStr) return; // silent no-op, matches the original
    setError(null);
    let choice: MarkLeaveChoice | null = null;
    if (slotInfo) {
      if (mode === "temp") choice = { mode: "temp" };
      else if (mode === "restday") choice = { mode: "restday", coverGuardId };
      else if (mode === "support") {
        // Support mode requires a cross-site guard lookup this panel doesn't have wired yet.
        setError("Support guard replacement isn't available from this panel yet — use Temporary guard or Rest day.");
        return;
      }
    }
    const outcome = applyMarkLeave(config, ms, guardId, dateStr, reason, slotInfo, choice);
    if ("error" in outcome) {
      setError(outcome.error);
      return;
    }
    setMode("");
    setCoverGuardId("");
    onSave(outcome.ms);
  }

  function handleClear(date: string) {
    const outcome = applyClearLeaveDay(ms, date, {});
    onSave(outcome.ms);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Mark a guard on leave</h3>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <select className="input" value={guardId} onChange={(e) => setGuardId(e.target.value)}>
          <option value="">Select a guard…</option>
          {guards.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <input type="date" className="input" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        <select className="input col-span-2" value={reason} onChange={(e) => setReason(e.target.value)}>
          {LEAVE_REASONS.filter((r) => r !== "Support (Other Site)" || canAssignSupport).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {guardId && dateStr && (
        <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
          {note}
          {slotInfo && (
            <div className="flex flex-col gap-1.5 mt-2">
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as LeaveReplacementMode)}>
                <option value="">Choose how it's covered…</option>
                <option value="temp">Temporary guard</option>
                <option value="restday">Current guard on rest day</option>
                {canAssignSupport && <option value="support">Support (borrow from another site)</option>}
              </select>
              {mode === "restday" && (
                <select className="input" value={coverGuardId} onChange={(e) => setCoverGuardId(e.target.value)}>
                  <option value="">Select a resting guard…</option>
                  {resting.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

      <div className="flex justify-end mt-3">
        <button type="button" onClick={handleAdd} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
          Mark on leave
        </button>
      </div>

      {rows.length > 0 && (
        <table className="w-full text-sm mt-4 border-collapse">
          <tbody>
            {rows.map((row) => (
              <tr key={row.date} className="border-t border-slate-100 align-top">
                <td className="py-1.5 font-mono text-xs whitespace-nowrap">{row.date}</td>
                <td className="py-1.5">
                  {row.cells.map((c) => (
                    <div key={c.guardId} className="mb-1 last:mb-0">
                      <span>{c.guardName}</span>{" "}
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs" style={{ background: "#F7ECD8", color: "#9A6A15" }}>
                        {c.reason}
                      </span>
                      {c.replacementPill && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs ml-1" style={{ background: "#DEEBE5", color: "#2F6F5E" }}>
                          {c.replacementPill.text}
                        </span>
                      )}
                      {c.destinationPill && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs ml-1" style={{ background: "#DEEBE5", color: "#2F6F5E" }}>
                          {c.destinationPill.text}
                        </span>
                      )}
                    </div>
                  ))}
                </td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => handleClear(row.date)} className="text-xs font-medium text-rose-600 hover:text-rose-700">
                    Clear
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
