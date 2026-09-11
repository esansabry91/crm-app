import { useEffect, useState } from 'react';
import type { Guard } from '../../types';
import { updateGuardPermitExpiry } from '../../services/guards';
import { formatDate, formatDateTime } from '../../utils/format';

/**
 * Read-only "View" popup for a Guard Bank record — surfaces every field the original "Add
 * guard"/"Register guard" form collects (see GuardIdentityInput in services/guards.ts) plus
 * Guard Bank's own status/assignment/dismissal bookkeeping, none of which fit in the tables'
 * columns. The one field NOT shown here is `position` — that's tied to a specific deployed
 * site's own rate configuration (see ratePositionNames() in public/duty-roster/index.html) and
 * was never part of what Guard Bank tracks, so there's nothing to show even once deployed.
 *
 * The one field that IS editable here is Permit expiry date, via the small "Update" control
 * beside it — everything else on a Guard Bank record only ever changes through Duty
 * Roster/Assign/Dismiss actions, but a permit renewal has nowhere else to be recorded. The
 * `guard` prop is resolved live from GuardBankPage's `guards` list (see viewGuard there), so a
 * save here is reflected immediately without needing to close and reopen this modal.
 */
export default function GuardDetailsModal({
  guard,
  onClose,
  onUpdated,
}: {
  guard: Guard | null;
  onClose: () => void;
  onUpdated?: (message: string) => void;
}) {
  const [editingPermit, setEditingPermit] = useState(false);
  const [permitDraft, setPermitDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [permitError, setPermitError] = useState<string | null>(null);

  // Reset the edit control whenever the modal switches to a different guard (or closes) — it's
  // one persistent component instance reused across every "View" click, not remounted per guard.
  useEffect(() => {
    setEditingPermit(false);
    setPermitDraft('');
    setPermitError(null);
  }, [guard?.id]);

  if (!guard) return null;

  function startEditPermit() {
    setPermitDraft(guard!.permitExpiryDate || '');
    setPermitError(null);
    setEditingPermit(true);
  }

  async function savePermit() {
    if (!guard) return;
    if (!permitDraft) {
      setPermitError('Pick the new expiry date.');
      return;
    }
    setSaving(true);
    setPermitError(null);
    try {
      await updateGuardPermitExpiry(guard.id, permitDraft);
      onUpdated?.(`Updated ${guard.name}'s permit expiry to ${formatDate(permitDraft)}.`);
      setEditingPermit(false);
    } catch (err) {
      setPermitError(err instanceof Error ? err.message : 'Could not update the permit expiry date.');
    } finally {
      setSaving(false);
    }
  }

  const topRows: { label: string; value: string }[] = [
    { label: 'Full name', value: guard.name },
    { label: 'Employee ID', value: guard.employeeId },
    { label: 'Category', value: guard.category === 'nepal' ? 'Nepal' : 'Local' },
    { label: 'Age', value: guard.age != null ? String(guard.age) : '-' },
    { label: 'State', value: guard.state || '-' },
    { label: 'City', value: guard.city || '-' },
  ];

  if (guard.category === 'nepal') {
    topRows.push({ label: 'Passport number', value: guard.passportNumber || '-' });
  } else {
    topRows.push({ label: 'MyKad number', value: guard.mykadNumber || '-' }, { label: 'Phone number', value: guard.phoneNumber || '-' });
  }

  const bottomRows: { label: string; value: string }[] = [
    {
      label: 'Status',
      value: guard.status === 'pool' ? 'Guard Pool (unassigned)' : guard.status === 'deployed' ? 'Deployed' : 'Dismissed',
    },
  ];

  if (guard.status !== 'pool') {
    bottomRows.push(
      { label: 'Site', value: guard.siteName || '-' },
      { label: 'Branch', value: guard.branch || 'Unassigned' },
      { label: 'Brand', value: guard.brandName || '-' }
    );
  }

  if (guard.status === 'dismissed') {
    bottomRows.push(
      { label: 'Dismissal reason', value: guard.dismissalReason || 'Unspecified' },
      { label: 'Dismissed on', value: guard.dismissedAt ? formatDateTime(guard.dismissedAt) : '-' }
    );
  }

  bottomRows.push({ label: 'Registered', value: formatDateTime(guard.createdAt) }, { label: 'Last updated', value: formatDateTime(guard.updatedAt) });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{guard.name}</h2>
        <p className="text-sm text-slate-500 mt-0.5">Full Guard Bank record</p>
        <dl className="mt-4 divide-y divide-slate-50">
          {topRows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0">{r.label}</dt>
              <dd className="text-slate-800 font-medium text-right">{r.value}</dd>
            </div>
          ))}

          {guard.category === 'nepal' && (
            <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0 pt-1">Permit expiry date</dt>
              <dd className="text-slate-800 text-right">
                {editingPermit ? (
                  <div className="flex items-center gap-2 justify-end flex-wrap">
                    <input
                      type="date"
                      className="input w-40 py-1"
                      value={permitDraft}
                      onChange={(e) => setPermitDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={savePermit}
                      disabled={saving}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-60"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPermit(false)}
                      disabled={saving}
                      className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 justify-end">
                    <span className="font-medium">{guard.permitExpiryDate ? formatDate(guard.permitExpiryDate) : '-'}</span>
                    <button
                      type="button"
                      onClick={startEditPermit}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2"
                    >
                      Update
                    </button>
                  </div>
                )}
                {editingPermit && permitError && <p className="text-xs text-rose-600 mt-1">{permitError}</p>}
              </dd>
            </div>
          )}

          {bottomRows.map((r) => (
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
