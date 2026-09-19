import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      setPermitError(t('guardBank.guardDetailsModal.errorPickExpiryDate'));
      return;
    }
    setSaving(true);
    setPermitError(null);
    try {
      await updateGuardPermitExpiry(guard.id, permitDraft);
      onUpdated?.(t('guardBank.guardDetailsModal.toastPermitUpdated', { name: guard.name, date: formatDate(permitDraft) }));
      setEditingPermit(false);
    } catch (err) {
      setPermitError(err instanceof Error ? err.message : t('guardBank.guardDetailsModal.errorCouldNotUpdatePermit'));
    } finally {
      setSaving(false);
    }
  }

  const topRows: { label: string; value: string }[] = [
    { label: t('guardBank.guardDetailsModal.fullNameLabel'), value: guard.name },
    { label: t('guardBank.colEmployeeId'), value: guard.employeeId },
    { label: t('guardBank.colCategory'), value: guard.category === 'nepal' ? t('guardBank.categoryNepal') : t('guardBank.categoryLocal') },
    { label: t('guardBank.guardDetailsModal.ageLabel'), value: guard.age != null ? String(guard.age) : '-' },
    { label: t('guardBank.guardDetailsModal.stateLabel'), value: guard.state || '-' },
    { label: t('guardBank.guardDetailsModal.cityLabel'), value: guard.city || '-' },
  ];

  if (guard.category === 'nepal') {
    topRows.push({ label: t('guardBank.guardDetailsModal.passportNumberLabel'), value: guard.passportNumber || '-' });
  } else {
    topRows.push(
      { label: t('guardBank.guardDetailsModal.mykadNumberLabel'), value: guard.mykadNumber || '-' },
      { label: t('guardBank.guardDetailsModal.phoneNumberLabel'), value: guard.phoneNumber || '-' }
    );
  }

  const bottomRows: { label: string; value: string }[] = [
    {
      label: t('guardBank.guardDetailsModal.statusLabel'),
      value:
        guard.status === 'pool'
          ? t('guardBank.guardDetailsModal.statusPool')
          : guard.status === 'deployed'
            ? t('guardBank.guardDetailsModal.statusDeployed')
            : t('guardBank.guardDetailsModal.statusDismissed'),
    },
  ];

  if (guard.status !== 'pool') {
    bottomRows.push(
      { label: t('guardBank.colSite'), value: guard.siteName || '-' },
      { label: t('guardBank.colBranch'), value: guard.branch || t('guardBank.unassignedBranch') },
      { label: t('guardBank.colBrand'), value: guard.brandName || '-' }
    );
  }

  if (guard.status === 'dismissed') {
    bottomRows.push(
      { label: t('guardBank.guardDetailsModal.dismissalReasonLabel'), value: guard.dismissalReason || t('guardBank.unspecified') },
      { label: t('guardBank.guardDetailsModal.dismissedOnLabel'), value: guard.dismissedAt ? formatDateTime(guard.dismissedAt) : '-' }
    );
  }

  bottomRows.push(
    { label: t('guardBank.colRegistered'), value: formatDateTime(guard.createdAt) },
    { label: t('guardBank.guardDetailsModal.lastUpdatedLabel'), value: formatDateTime(guard.updatedAt) }
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-slate-900">{guard.name}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{t('guardBank.guardDetailsModal.subtitle')}</p>
        <dl className="mt-4 divide-y divide-slate-50">
          {topRows.map((r) => (
            <div key={r.label} className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0">{r.label}</dt>
              <dd className="text-slate-800 font-medium text-right">{r.value}</dd>
            </div>
          ))}

          {guard.category === 'nepal' && (
            <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
              <dt className="text-slate-500 shrink-0 pt-1">{t('guardBank.registerGuardModal.permitExpiryDateLabel')}</dt>
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
                      {saving ? t('guardBank.guardDetailsModal.savingEllipsis') : t('guardBank.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingPermit(false)}
                      disabled={saving}
                      className="text-xs font-medium text-slate-400 hover:text-slate-600 disabled:opacity-60"
                    >
                      {t('guardBank.cancel')}
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
                      {t('guardBank.guardDetailsModal.updateLink')}
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
            {t('guardBank.guardDetailsModal.closeButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
