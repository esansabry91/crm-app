import type { BufferGuard } from '../../types';
import { formatDateTime, formatRM } from '../../utils/format';

/** Read-only "View" popup for a Buffer Guard row — the table already shows most of this inline,
 *  but keeps the same pattern as GuardDetailsModal so every tab has a consistent way to see the
 *  full record without hunting across columns. */
export default function BufferGuardDetailsModal({
  bufferGuard,
  onClose,
}: {
  bufferGuard: BufferGuard | null;
  onClose: () => void;
}) {
  if (!bufferGuard) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Name', value: bufferGuard.name },
    { label: 'Rate', value: formatRM(bufferGuard.rate || 0) },
    { label: 'MyKad number', value: bufferGuard.mykadNumber || '-' },
    { label: 'Age', value: bufferGuard.age != null ? String(bufferGuard.age) : '-' },
    { label: 'Phone number', value: bufferGuard.phoneNumber || '-' },
    { label: 'State', value: bufferGuard.state || '-' },
    { label: 'City', value: bufferGuard.city || '-' },
    { label: 'Last site', value: bufferGuard.lastSiteName || '-' },
    { label: 'Last branch', value: bufferGuard.lastBranch || 'Unassigned' },
    { label: 'First used', value: formatDateTime(bufferGuard.firstUsedAt) },
    { label: 'Last used', value: formatDateTime(bufferGuard.lastUsedAt) },
    { label: 'Times used', value: String(bufferGuard.timesUsed) },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{bufferGuard.name}</h2>
        <p className="text-sm text-slate-500 mt-0.5">Full Buffer Guard record</p>
        <dl className="mt-4 divide-y divide-slate-50">
          {rows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0">{r.label}</dt>
              <dd className="text-slate-800 font-medium text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
