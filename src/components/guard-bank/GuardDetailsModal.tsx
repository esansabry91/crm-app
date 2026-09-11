import type { Guard } from '../../types';
import { formatDate, formatDateTime } from '../../utils/format';

/**
 * Read-only "View" popup for a Guard Bank record — surfaces every field the original "Add
 * guard"/"Register guard" form collects (see GuardIdentityInput in services/guards.ts) plus
 * Guard Bank's own status/assignment/dismissal bookkeeping, none of which fit in the tables'
 * columns. The one field NOT shown here is `position` — that's tied to a specific deployed
 * site's own rate configuration (see ratePositionNames() in public/duty-roster/index.html) and
 * was never part of what Guard Bank tracks, so there's nothing to show even once deployed.
 */
export default function GuardDetailsModal({ guard, onClose }: { guard: Guard | null; onClose: () => void }) {
  if (!guard) return null;

  const rows: { label: string; value: string }[] = [
    { label: 'Full name', value: guard.name },
    { label: 'Employee ID', value: guard.employeeId },
    { label: 'Category', value: guard.category === 'nepal' ? 'Nepal' : 'Local' },
    { label: 'Age', value: guard.age != null ? String(guard.age) : '-' },
    { label: 'State', value: guard.state || '-' },
    { label: 'City', value: guard.city || '-' },
  ];

  if (guard.category === 'nepal') {
    rows.push(
      { label: 'Passport number', value: guard.passportNumber || '-' },
      { label: 'Permit expiry date', value: guard.permitExpiryDate ? formatDate(guard.permitExpiryDate) : '-' }
    );
  } else {
    rows.push({ label: 'MyKad number', value: guard.mykadNumber || '-' }, { label: 'Phone number', value: guard.phoneNumber || '-' });
  }

  rows.push({
    label: 'Status',
    value: guard.status === 'pool' ? 'Guard Pool (unassigned)' : guard.status === 'deployed' ? 'Deployed' : 'Dismissed',
  });

  if (guard.status !== 'pool') {
    rows.push(
      { label: 'Site', value: guard.siteName || '-' },
      { label: 'Branch', value: guard.branch || 'Unassigned' },
      { label: 'Brand', value: guard.brandName || '-' }
    );
  }

  if (guard.status === 'dismissed') {
    rows.push(
      { label: 'Dismissal reason', value: guard.dismissalReason || 'Unspecified' },
      { label: 'Dismissed on', value: guard.dismissedAt ? formatDateTime(guard.dismissedAt) : '-' }
    );
  }

  rows.push({ label: 'Registered', value: formatDateTime(guard.createdAt) }, { label: 'Last updated', value: formatDateTime(guard.updatedAt) });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{guard.name}</h2>
        <p className="text-sm text-slate-500 mt-0.5">Full Guard Bank record</p>
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
