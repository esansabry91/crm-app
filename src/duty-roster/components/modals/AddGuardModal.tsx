import { useEffect, useState } from "react";
import type { Guard } from "../../types";
import { formatMykadInput, formatPhoneInput } from "../../guardValidation";
import { validateAddGuardForm, type AddGuardFormValues, type GuardCategory } from "../../addGuardData";

/**
 * openAddGuardModal() + renderAddGuardCategoryFields() (index.html lines 1846-1978). Only
 * rendered while `open` — the caller (GuardsShiftsTab) is expected to have already checked
 * `allSiteSetupSaved()` before opening this (the "+ Add guard" button double-checks this too, per
 * the original — belt-and-braces beyond the disabled attribute).
 */
export interface AddGuardModalProps {
  open: boolean;
  /** ratePositionNames(rateConfig) — the Position field is entirely absent from the DOM
   * (not just hidden) when this is empty, matching the original. */
  positionNames: string[];
  onClose: () => void;
  onSubmit: (guard: Guard) => void;
}

const EMPTY_FORM: AddGuardFormValues = {
  category: "local",
  employeeId: "",
  name: "",
  state: "",
  city: "",
  position: "",
  ageRaw: "",
  passportNumber: "",
  permitExpiryDate: "",
  mykadNumber: "",
  phoneNumber: "",
};

export default function AddGuardModal({ open, positionNames, onClose, onSubmit }: AddGuardModalProps) {
  const [form, setForm] = useState<AddGuardFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  function set<K extends keyof AddGuardFormValues>(key: K, value: AddGuardFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    const result = validateAddGuardForm(form, positionNames);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onSubmit(result.guard);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Add guard</h2>

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Guard category</label>
        <select className="input" value={form.category} onChange={(e) => set("category", e.target.value as GuardCategory)}>
          <option value="local">Local</option>
          <option value="nepal">Nepal</option>
        </select>

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Employee ID</label>
        <input className="input" type="text" value={form.employeeId} onChange={(e) => set("employeeId", e.target.value)} />

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">
          {form.category === "nepal" ? "Full name" : "Full name (as per MyKad)"}
        </label>
        <input className="input" type="text" value={form.name} onChange={(e) => set("name", e.target.value)} />

        {form.category === "nepal" ? (
          <>
            <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Passport number</label>
            <input className="input" type="text" value={form.passportNumber} onChange={(e) => set("passportNumber", e.target.value)} />
            <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Permit expiry date</label>
            <input
              className="input"
              type="date"
              value={form.permitExpiryDate}
              onChange={(e) => set("permitExpiryDate", e.target.value)}
            />
          </>
        ) : (
          <>
            <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">MyKad number</label>
            <input
              className="input"
              type="text"
              maxLength={14}
              value={form.mykadNumber}
              onChange={(e) => set("mykadNumber", formatMykadInput(e.target.value))}
            />
            <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Phone number</label>
            <input
              className="input"
              type="text"
              value={form.phoneNumber}
              onChange={(e) => set("phoneNumber", formatPhoneInput(e.target.value))}
            />
          </>
        )}

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">State</label>
        <input className="input" type="text" value={form.state} onChange={(e) => set("state", e.target.value)} />

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">City</label>
        <input className="input" type="text" value={form.city} onChange={(e) => set("city", e.target.value)} />

        {positionNames.length > 0 && (
          <>
            <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Position</label>
            <select className="input" value={form.position} onChange={(e) => set("position", e.target.value)}>
              <option value="">Select a position…</option>
              {positionNames.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="text-xs font-medium text-slate-600 block mt-3 mb-1">Age</label>
        <input
          className="input"
          type="number"
          min={16}
          max={80}
          step={1}
          value={form.ageRaw}
          onChange={(e) => set("ageRaw", e.target.value)}
        />

        {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button type="button" onClick={submit} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
            Add guard
          </button>
        </div>
      </div>
    </div>
  );
}
