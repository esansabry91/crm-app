import type { Guard, TenderRateConfig } from "../../types";
import { guardDetailRows } from "../../addGuardData";

/**
 * openGuardDetailsModal() (index.html lines 1998-2036) — read-only "View" for a permanent
 * guard on this site's own roster. Not to be confused with the Guard Bank app's own, separately
 * maintained src/components/guard-bank/GuardDetailsModal.tsx (different data source, different
 * fields — this one is scoped to a single site's `guards[]` entry, live-resolves Rate off the
 * linked tender).
 */
export interface DutyRosterGuardDetailsModalProps {
  guard: Guard | null;
  rateConfig: TenderRateConfig | null;
  onClose: () => void;
}

export default function DutyRosterGuardDetailsModal({ guard, rateConfig, onClose }: DutyRosterGuardDetailsModalProps) {
  if (!guard) return null;
  const rows = guardDetailRows(guard, rateConfig);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{guard.name}</h2>
        <dl className="mt-3 divide-y divide-slate-50">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0">{r.label}</dt>
              <dd className="text-slate-800 font-medium text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end mt-5">
          <button type="button" onClick={onClose} className="px-4 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
