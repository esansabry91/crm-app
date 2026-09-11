import { useEffect, useState, type FormEvent } from 'react';
import type { Tender } from '../../types';
import { updateActiveProjectDetails } from '../../services/tenders';

interface Props {
  open: boolean;
  onClose: () => void;
  tender: Tender | null;
  /**
   * The tender's live Duty Roster active-guard count, when it has one (see
   * useLiveGuardCountsByTender in hooks/useActiveProjects.ts) — undefined means no live site
   * exists yet, so the manual field below still works as a plain typed-in number. When a live
   * count IS present, guardsDeployed is roster-driven and the field becomes a read-only display
   * instead, so nobody types a number here that the roster would just overwrite the meaning of.
   */
  liveGuardCount?: number;
}

/**
 * Lets anyone who can see a project in Active Projects (its branch-mates, HQ, or admin — the
 * same audience Firestore's read rule allows) fill in the operational details that aren't part
 * of the sales record: worksite location (state, city, postcode included), an on-site/client
 * contact, how many guards are currently deployed, and the tender document reference number.
 * Deliberately separate from TenderFormModal — that one edits the sales record and is locked to
 * the owner/admin; this one edits only these seven fields, which the Firestore rules allow more
 * people to touch. Every field here is required before Save will submit — see handleSave — except
 * Security Guards Deployed once it's roster-driven (see the liveGuardCount prop doc comment),
 * since it's then a read-only display rather than something anyone types into.
 */
export default function ProjectDetailsModal({ open, onClose, tender, liveGuardCount }: Props) {
  const [location, setLocation] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [guardsDeployed, setGuardsDeployed] = useState('');
  const [tenderDocNumber, setTenderDocNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tender) return;
    setLocation(tender.location || '');
    setStateName(tender.state || '');
    setCity(tender.city || '');
    setPostcode(tender.postcode || '');
    setContactPerson(tender.contactPerson || '');
    setGuardsDeployed(tender.guardsDeployed != null ? String(tender.guardsDeployed) : '');
    setTenderDocNumber(tender.tenderDocNumber || '');
    setError(null);
  }, [open, tender]);

  if (!open || !tender) return null;

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Every field on this form is required before it can be saved.
    if (!location.trim()) { setError('Location is required.'); return; }
    if (!stateName.trim()) { setError('State is required.'); return; }
    if (!city.trim()) { setError('City is required.'); return; }
    if (!postcode.trim()) { setError('Postcode is required.'); return; }
    if (!contactPerson.trim()) { setError('Contact Person is required.'); return; }
    if (!tenderDocNumber.trim()) { setError('Tender Document No. is required.'); return; }

    // Never overwrite a roster-driven count from this manual field — see the liveGuardCount
    // prop doc comment above. When there's no live site, this is a plain required field like
    // everything else here rather than something that can be left blank.
    let guards: number | undefined;
    if (liveGuardCount == null) {
      if (guardsDeployed.trim() === '') {
        setError('Security Guards Deployed is required.');
        return;
      }
      guards = Number(guardsDeployed);
      if (!Number.isFinite(guards) || guards < 0) {
        setError('Enter a valid number of guards.');
        return;
      }
    }

    setSaving(true);
    try {
      await updateActiveProjectDetails(tender.id, {
        location: location.trim(),
        state: stateName.trim(),
        city: city.trim(),
        postcode: postcode.trim(),
        contactPerson: contactPerson.trim(),
        tenderDocNumber: tenderDocNumber.trim(),
        ...(guards !== undefined ? { guardsDeployed: guards } : {}),
      });
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not save these details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Project Details</h2>
            <p className="text-xs text-slate-400 mt-0.5">{tender.clientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          <Field label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input"
              placeholder="e.g. Menara ABC, Jalan Ampang, KL"
            />
          </Field>

          <Field label="State">
            <input
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              className="input"
              placeholder="e.g. Selangor"
            />
          </Field>

          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="input"
              placeholder="e.g. Petaling Jaya"
            />
          </Field>

          <Field label="Postcode">
            <input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              className="input"
              placeholder="e.g. 50450"
            />
          </Field>

          <Field label="Contact Person">
            <input
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              className="input"
              placeholder="Name, phone or email"
            />
          </Field>

          <Field label="Security Guards Deployed">
            {liveGuardCount != null ? (
              <div className="input bg-slate-50 text-slate-600 flex items-center justify-between gap-2">
                <span className="font-medium">
                  {liveGuardCount} guard{liveGuardCount === 1 ? '' : 's'}
                </span>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">Synced from Duty Roster</span>
              </div>
            ) : (
              <input
                type="number"
                min={0}
                value={guardsDeployed}
                onChange={(e) => setGuardsDeployed(e.target.value)}
                className="input"
                placeholder="0"
              />
            )}
          </Field>

          <Field label="Tender Document No.">
            <input
              value={tenderDocNumber}
              onChange={(e) => setTenderDocNumber(e.target.value)}
              className="input"
              placeholder="e.g. IPSB/T-2026/014"
            />
          </Field>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
