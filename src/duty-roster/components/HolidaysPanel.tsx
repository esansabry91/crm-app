import { useState } from "react";
import type { SiteConfig, MonthState } from "../types";
import {
  MALAYSIA_STATES,
  siteStateSubText,
  stateChangeNeedsConfirm,
  stateChangeConfirmMessage,
  applyStateAssignment,
  buildHolidayRows,
  applyAddHoliday,
  removeHolidayConfirmMessage,
  applyRemoveHoliday,
  applySaveHolidays,
} from "../siteSetupData";
import ConfirmModal from "./modals/ConfirmModal";

/**
 * "Public holidays" panel (renderSiteStateSelect()/renderHolidayTable() + their Add/Remove/Save
 * handlers, index.html lines 3561-3612, 5011-5156).
 */
export interface HolidaysPanelProps {
  config: SiteConfig;
  ms: MonthState;
  onSave: (next: { config: SiteConfig; ms: MonthState }, toast: string) => void;
}

export default function HolidaysPanel({ config, ms, onSave }: HolidaysPanelProps) {
  const [pendingState, setPendingState] = useState<string | null | undefined>(undefined);
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ date: string; name: string | null } | null>(null);

  const rows = buildHolidayRows(config);

  function commitStateChange(nextState: string | null) {
    const outcome = applyStateAssignment(config, ms, nextState);
    onSave({ config: outcome.config, ms: outcome.ms }, outcome.toast);
    setPendingState(undefined);
  }

  function handleStateSelect(value: string) {
    const nextState = value || null;
    if (stateChangeNeedsConfirm(config, nextState)) {
      setPendingState(nextState);
    } else {
      commitStateChange(nextState);
    }
  }

  function handleAddHoliday() {
    const result = applyAddHoliday(config, ms, newDate, newName);
    if ("error" in result) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setNewDate("");
    setNewName("");
    onSave({ config: result.config, ms: result.ms }, result.toast);
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    const outcome = applyRemoveHoliday(config, ms, removeTarget.date);
    onSave({ config: outcome.config, ms: outcome.ms }, outcome.toast);
    setRemoveTarget(null);
  }

  function handleSaveHolidays() {
    const outcome = applySaveHolidays(config, ms);
    onSave({ config: outcome.config, ms: outcome.ms }, outcome.toast);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Public holidays</h3>

      <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">State</label>
      <select className="input" value={config.state || ""} onChange={(e) => handleStateSelect(e.target.value)}>
        <option value="">Not set — add holidays manually</option>
        {MALAYSIA_STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500 mt-1.5">{siteStateSubText(config)}</p>

      <div className="flex gap-2 mt-4">
        <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        <input
          type="text"
          className="input"
          placeholder="Holiday name (optional)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          onClick={handleAddHoliday}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap"
        >
          Add
        </button>
      </div>
      {addError && <p className="text-sm text-rose-600 mt-1.5">{addError}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 mt-3">No public holidays set for this site yet.</p>
      ) : (
        <table className="w-full text-sm mt-3 border-collapse">
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-xs">{r.date}</td>
                <td className="py-1.5">{r.name || "—"}</td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setRemoveTarget({ date: r.date, name: r.name })}
                    className="text-xs font-medium text-rose-600 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={handleSaveHolidays}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          Save Holidays
        </button>
      </div>

      <ConfirmModal
        open={pendingState !== undefined}
        title="Change assigned state?"
        message={pendingState !== undefined ? stateChangeConfirmMessage(config, pendingState) : ""}
        onConfirm={() => commitStateChange(pendingState ?? null)}
        onCancel={() => setPendingState(undefined)}
      />
      <ConfirmModal
        open={!!removeTarget}
        title="Remove public holiday"
        message={removeTarget ? removeHolidayConfirmMessage(removeTarget.date, removeTarget.name) : ""}
        okLabel="Remove"
        danger
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
