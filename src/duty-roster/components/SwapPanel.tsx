import { useState } from "react";
import type { SiteConfig, MonthState, GenerateMonthResult } from "../types";
import { shiftOptionsForDate, swapSlotCount, applySwap, type SwapSlotRef } from "../swapData";

/**
 * "Swap two shifts" panel (renderSwapControls(), index.html lines 4706-4749, #swapBtn line 5596).
 */
export interface SwapPanelProps {
  config: SiteConfig;
  ms: MonthState;
  result: GenerateMonthResult;
  currentMonthKey: string;
  onSave: (ms: MonthState, toast: string) => void;
}

function SideFields({
  label,
  site,
  date,
  shiftId,
  slot,
  onDate,
  onShift,
  onSlot,
}: {
  label: string;
  site: SiteConfig["site"];
  date: string;
  shiftId: string;
  slot: number;
  onDate: (v: string) => void;
  onShift: (v: string) => void;
  onSlot: (v: number) => void;
}) {
  const shiftOptions = shiftOptionsForDate(site, date || null);
  const effectiveShiftId = shiftId || shiftOptions[0]?.id || "";
  const slotCount = swapSlotCount(site, date || null, effectiveShiftId);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <input type="date" className="input" value={date} onChange={(e) => onDate(e.target.value)} />
      <select className="input" value={effectiveShiftId} onChange={(e) => onShift(e.target.value)}>
        {shiftOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      {slotCount === 0 ? (
        <select className="input" disabled value="">
          <option value="">No slots that day</option>
        </select>
      ) : (
        <select className="input" value={slot} onChange={(e) => onSlot(Number(e.target.value))}>
          {Array.from({ length: slotCount }, (_, i) => (
            <option key={i} value={i}>
              Slot {i + 1}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function SwapPanel({ config, ms, result, currentMonthKey, onSave }: SwapPanelProps) {
  const [dateA, setDateA] = useState("");
  const [shiftA, setShiftA] = useState("");
  const [slotA, setSlotA] = useState(0);
  const [dateB, setDateB] = useState("");
  const [shiftB, setShiftB] = useState("");
  const [slotB, setSlotB] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function handleSwap() {
    if (!dateA || !dateB) {
      setError("Pick both dates.");
      return;
    }
    if (dateA.slice(0, 7) !== currentMonthKey || dateB.slice(0, 7) !== currentMonthKey) {
      setError("Swap only within the month currently shown. Navigate to that month first.");
      return;
    }
    setError(null);
    const a: SwapSlotRef = { date: dateA, shiftId: shiftA || shiftOptionsForDate(config.site, dateA)[0]?.id || "", slot: slotA };
    const b: SwapSlotRef = { date: dateB, shiftId: shiftB || shiftOptionsForDate(config.site, dateB)[0]?.id || "", slot: slotB };
    const outcome = applySwap(config, ms, result, a, b);
    onSave(outcome.ms, outcome.toast);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Swap two shifts</h3>
      <div className="grid grid-cols-2 gap-4 mt-3">
        <SideFields label="Shift A" site={config.site} date={dateA} shiftId={shiftA} slot={slotA} onDate={setDateA} onShift={setShiftA} onSlot={setSlotA} />
        <SideFields label="Shift B" site={config.site} date={dateB} shiftId={shiftB} slot={slotB} onDate={setDateB} onShift={setShiftB} onSlot={setSlotB} />
      </div>
      {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      <div className="flex justify-end mt-3">
        <button type="button" onClick={handleSwap} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
          Swap
        </button>
      </div>
    </div>
  );
}
