import { useEffect, useRef, useState } from "react";
import type { SiteConfig, MonthState, GenerateMonthResult, TempGuardRecord } from "../types";
import {
  buildTempSlotOptions,
  buildTempGuardRows,
  validateTempGuardForm,
  applyAssignTempGuard,
  applyRemoveTempGuard,
  removeTempOrSupportGuardConfirmMessage,
  type TempGuardFormValues,
} from "../tempGuardPanelData";
import { formatMykadInput, formatPhoneInput, isValidMykad } from "../guardValidation";
import { lookupBufferGuardMatch, syncBufferGuardOnAssign, type SiteMeta } from "../guardBankSync";
import { monthTempGuards } from "../rosterModel";
import ConfirmModal from "./modals/ConfirmModal";
import TempGuardDetailsModal from "./modals/TempGuardDetailsModal";

const EMPTY_FORM: TempGuardFormValues = {
  slotKey: "",
  name: "",
  rateRaw: "",
  mykadNumber: "",
  ageRaw: "",
  phoneNumber: "",
  state: "",
  city: "",
};

/**
 * "Assign a temporary guard" panel (renderTempGuardPanel(), index.html lines 3972-4035;
 * #assignTempBtn line 5298; scheduleTempGuardMatchLookup()/lookupBufferGuardForTempForm(), lines
 * 6283-6309 — the DOM-bound 400ms-debounced wrapper around guardBankSync.ts's
 * lookupBufferGuardMatch(), reimplemented here as a useEffect debounce).
 */
export interface TempGuardPanelProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  siteMeta: SiteMeta;
  isTestData: boolean;
  onSave: (ms: MonthState, toast: string) => void;
}

export default function TempGuardPanel({ config, ms, result, siteMeta, isTestData, onSave }: TempGuardPanelProps) {
  const [form, setForm] = useState<TempGuardFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [matchHint, setMatchHint] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ tempId: string; name: string } | null>(null);
  const [viewRecord, setViewRecord] = useState<TempGuardRecord | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slotOptions = buildTempSlotOptions(result.conflicts);
  const { rows, total } = buildTempGuardRows(config, ms);

  function set<K extends keyof TempGuardFormValues>(key: K, value: TempGuardFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // scheduleTempGuardMatchLookup()/lookupBufferGuardForTempForm() — only wired to name+mykad,
  // requires a fully-valid-format MyKad before even querying, and discards a stale response if
  // the fields changed while the fetch was in flight.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const name = form.name.trim();
    const mykad = form.mykadNumber.trim();
    if (!name || !isValidMykad(mykad)) {
      setMatchHint(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const match = await lookupBufferGuardMatch(name, mykad);
      // Staleness guard: bail if the fields have since changed.
      if (form.name.trim() !== name || form.mykadNumber.trim() !== mykad) return;
      if (!match) {
        setMatchHint(null);
        return;
      }
      setForm((f) => ({
        ...f,
        ageRaw: match.age != null ? String(match.age) : f.ageRaw,
        phoneNumber: match.phoneNumber || f.phoneNumber,
        state: match.state || f.state,
        city: match.city || f.city,
      }));
      const lastRate = match.rate != null ? `RM ${Number(match.rate).toFixed(2)}` : "unknown";
      setMatchHint(
        `Matched a buffer guard used ${match.timesUsed} time${match.timesUsed === 1 ? "" : "s"} before — last rate ${lastRate}. Age/Phone/State/City filled in from their last record; enter today's rate above.`
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.name, form.mykadNumber]);

  function handleAssign() {
    const result2 = validateTempGuardForm(form);
    if ("error" in result2) {
      setError(result2.error);
      return;
    }
    setError(null);
    const outcome = applyAssignTempGuard(config, ms, form.slotKey, result2.record);
    setForm(EMPTY_FORM);
    setMatchHint(null);
    onSave(outcome.ms, outcome.toast);
    syncBufferGuardOnAssign(outcome.record, siteMeta, isTestData);
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    const outcome = applyRemoveTempGuard(ms, removeTarget.tempId);
    setRemoveTarget(null);
    if (!outcome) return;
    onSave(outcome.ms, outcome.toast);
  }

  const tg = monthTempGuards(ms);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Assign a temporary guard</h3>

      {slotOptions.length === 0 ? (
        <p className="text-xs text-slate-400 mt-2">No unfilled slots this month.</p>
      ) : (
        <div className="flex flex-col gap-2 mt-3">
          <select className="input" value={form.slotKey} onChange={(e) => set("slotKey", e.target.value)}>
            <option value="">Select an unfilled slot…</option>
            {slotOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <input type="text" className="input" placeholder="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input
            type="number"
            min={0}
            step="0.01"
            className="input"
            placeholder="Rate (RM/manhour)"
            value={form.rateRaw}
            onChange={(e) => set("rateRaw", e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder="MyKad number"
            maxLength={14}
            value={form.mykadNumber}
            onChange={(e) => set("mykadNumber", formatMykadInput(e.target.value))}
          />
          {matchHint && <p className="text-xs" style={{ color: "#2F6F5E" }}>{matchHint}</p>}
          <input type="number" min={16} className="input" placeholder="Age" value={form.ageRaw} onChange={(e) => set("ageRaw", e.target.value)} />
          <input
            type="text"
            className="input"
            placeholder="Phone number"
            value={form.phoneNumber}
            onChange={(e) => set("phoneNumber", formatPhoneInput(e.target.value))}
          />
          <input type="text" className="input" placeholder="State" value={form.state} onChange={(e) => set("state", e.target.value)} />
          <input type="text" className="input" placeholder="City" value={form.city} onChange={(e) => set("city", e.target.value)} />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="button"
            onClick={handleAssign}
            className="self-end px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Assign
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <table className="w-full text-sm mt-4 border-collapse">
            <tbody>
              {rows.map((r) => (
                <tr key={r.tempId} className="border-t border-slate-100">
                  <td className="py-1.5 font-mono text-xs whitespace-nowrap">{r.date}</td>
                  <td className="py-1.5">{r.shiftSlotLabel}</td>
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 font-mono text-xs">{r.rate.toFixed(2)}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setViewRecord(tg[r.tempId])}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 mr-3"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoveTarget({ tempId: r.tempId, name: r.name })}
                      className="text-xs font-medium text-rose-600 hover:text-rose-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">Total to pay this month: RM {total.toFixed(2)}</p>
        </>
      )}

      <TempGuardDetailsModal record={viewRecord} onClose={() => setViewRecord(null)} />
      <ConfirmModal
        open={!!removeTarget}
        title="Remove temporary guard"
        message={removeTarget ? removeTempOrSupportGuardConfirmMessage(removeTarget.name) : ""}
        okLabel="Remove"
        danger
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
