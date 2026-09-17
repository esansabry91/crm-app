import { useEffect, useState } from "react";
import type { Guard } from "../../types";
import { DISMISS_REASONS } from "../../addGuardData";

/**
 * openDismissGuardModal() (index.html lines 1778-1805) — reason select is exactly 3 fixed
 * options, "Terminated" default/first.
 */
export interface DismissGuardModalProps {
  guard: Guard | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function DismissGuardModal({ guard, onConfirm, onCancel }: DismissGuardModalProps) {
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0]);

  useEffect(() => {
    if (guard) setReason(DISMISS_REASONS[0]);
  }, [guard?.id]);

  if (!guard) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Dismiss guard</h2>
        <p className="text-sm text-slate-600 mt-2">
          Dismiss {guard.name}? Pick a reason — this also moves them to the Dismissed tab in Guard Bank.
        </p>
        <select className="input mt-3" value={reason} onChange={(e) => setReason(e.target.value)}>
          {DISMISS_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            className="px-4 py-1.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
