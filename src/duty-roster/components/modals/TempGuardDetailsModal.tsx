import { useTranslation } from "react-i18next";
import type { TempGuardRecord } from "../../types";
import { tempGuardDetailRows } from "../../tempGuardPanelData";

/** openTempGuardDetailsModal() (index.html lines 3940-3971) — read-only "View" for a temp guard. */
export interface TempGuardDetailsModalProps {
  record: TempGuardRecord | null;
  onClose: () => void;
}

export default function TempGuardDetailsModal({ record, onClose }: TempGuardDetailsModalProps) {
  const { t } = useTranslation();
  if (!record) return null;
  const rows = tempGuardDetailRows(record, t);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">{record.name || "—"}</h2>
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
            {t('dutyRoster.common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
