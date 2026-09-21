import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Guard } from '../../types';
import { assignGuardToSite, type SitePickerOption } from '../../services/guards';

/**
 * Assigns a Guard Pool guard to a client site/branch, which is what actually moves them to
 * Deployed Guards (see assignGuardToSite()'s doc comment for the two writes this triggers). The
 * site list is whatever `useSitesForPicker` returned — already constrained to sites this
 * viewer can LIST under firestore.rules (own branch + unassigned, or every site for
 * admin/HQ/HR — see sitesListPlan()), so a non-privileged user only ever sees sites they
 * could reach in Duty Roster anyway.
 */
export default function AssignGuardModal({
  open,
  guard,
  sites,
  onClose,
  onAssigned,
}: {
  open: boolean;
  guard: Guard | null;
  sites: SitePickerOption[];
  onClose: () => void;
  onAssigned: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [siteId, setSiteId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSiteId(sites[0]?.id || '');
      setError(null);
    }
  }, [open, guard?.id, sites]);

  if (!open || !guard) return null;

  async function submit() {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return setError(t('guardBank.assignGuardModal.errorPickSite'));
    setSaving(true);
    setError(null);
    try {
      await assignGuardToSite(guard as Guard, site);
      onAssigned(t('guardBank.assignGuardModal.toastDeployed', { name: (guard as Guard).name, site: site.name }));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('guardBank.assignGuardModal.errorCouldNotAssign'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5">
        <h2 className="text-base font-semibold text-slate-900">{t('guardBank.assignGuardModal.title')}</h2>
        <p className="text-sm text-slate-500 mt-1.5">
          {t('guardBank.assignGuardModal.description', { name: guard.name })}
        </p>
        <div className="mt-4">
          <label className="text-xs font-medium text-slate-600 block mb-1">{t('guardBank.assignGuardModal.siteLabel')}</label>
          {sites.length === 0 ? (
            <p className="text-sm text-slate-400">{t('guardBank.assignGuardModal.noSitesAvailable')}</p>
          ) : (
            <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.branch ? ` — ${s.branch}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
            {t('guardBank.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || sites.length === 0}
            onClick={submit}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
          >
            {saving ? t('guardBank.assignGuardModal.assigningEllipsis') : t('guardBank.assignGuardModal.assignButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
