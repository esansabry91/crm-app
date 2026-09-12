import { useEffect, useState, type FormEvent } from 'react';
import type { Branch, Brand, Stage, Tender, UserProfile } from '../../types';
import { STAGES } from '../../types';
import {
  createTender,
  deleteTender,
  moveTenderStage,
  requalifyTender,
  setClosedDate,
  setSubmittedDate,
  updateTender,
} from '../../services/tenders';
import { formatDate } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  brands: Brand[];
  branches: Branch[];
  staffOptions: UserProfile[]; // selectable owners (admin only sees full list)
  editing: Tender | null; // null = creating new
}

export default function TenderFormModal({
  open,
  onClose,
  profile,
  brands,
  branches,
  staffOptions,
  editing,
}: Props) {
  const isAdmin = profile.role === 'admin';
  const departmentOptions = ['HQ', ...branches.map((b) => b.name)];

  const [clientName, setClientName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [department, setDepartment] = useState(profile.department || 'HQ');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [tenderValue, setTenderValue] = useState<string>('');
  const [stage, setStage] = useState<Stage>('New Lead');
  const [ownerUid, setOwnerUid] = useState(profile.uid);
  const [notes, setNotes] = useState('');
  const [closedDate, setClosedDateField] = useState('');
  const [submittedDate, setSubmittedDateField] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosedStage = stage === 'Won' || stage === 'Lost';
  const today = () => new Date().toISOString().slice(0, 10);

  // Shown whenever the tender is currently sitting in Submitted, or already has a submittedDate
  // from having passed through it before (even if it's since moved on to Negotiation/Won/Lost, or
  // regressed to an earlier stage) — so the date stays visible for the "time to convert" math
  // regardless of where the tender is now. Only actually REQUIRED (see validation below) the
  // moment stage is being set to Submitted for a tender that doesn't have one yet.
  const showSubmittedField = stage === 'Submitted' || !!editing?.submittedDate;
  const submittedDateAlreadySet = !!editing?.submittedDate;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setClientName(editing.clientName);
      setBrandId(editing.brandId);
      setDepartment(editing.department);
      setContractStart(editing.contractStart);
      setContractEnd(editing.contractEnd);
      setTenderValue(String(editing.tenderValue));
      setStage(editing.stage);
      setOwnerUid(editing.ownerUid);
      setNotes(editing.notes || '');
      setClosedDateField(editing.closedDate || (editing.stage === 'Won' || editing.stage === 'Lost' ? today() : ''));
      setSubmittedDateField(editing.submittedDate || (editing.stage === 'Submitted' ? today() : ''));
    } else {
      setClientName('');
      setBrandId(brands[0]?.id || '');
      setDepartment(profile.department || 'HQ');
      setContractStart('');
      setContractEnd('');
      setTenderValue('');
      setStage('New Lead');
      setOwnerUid(profile.uid);
      setNotes('');
      setClosedDateField('');
      setSubmittedDateField('');
    }
    setError(null);
  }, [open, editing, brands, profile]);

  // Default the closed-date field to today the moment someone switches stage to Won/Lost,
  // so it's never left blank — but don't clobber a value they've already backfilled.
  useEffect(() => {
    if (isClosedStage && !closedDate) setClosedDateField(today());
  }, [isClosedStage]);

  // Same convenience default for submittedDate the moment someone switches stage to Submitted —
  // but only while it's genuinely unset; once editing?.submittedDate exists this field is either
  // locked (non-admin) or an intentional correction (admin), and must never be silently reset.
  useEffect(() => {
    if (stage === 'Submitted' && !submittedDate && !submittedDateAlreadySet) setSubmittedDateField(today());
  }, [stage, submittedDateAlreadySet]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const value = Number(tenderValue);
    if (!clientName.trim()) return setError('Client name is required.');
    if (!brandId) return setError('Please select a brand.');
    if (!Number.isFinite(value) || value < 0) return setError('Enter a valid tender value.');
    if (showSubmittedField) {
      if (!submittedDate) return setError('Please enter the submission date.');
      if (submittedDate > today()) return setError('Submission date cannot be a future date.');
    }

    const owner = staffOptions.find((s) => s.uid === ownerUid) || profile;
    const brand = brands.find((b) => b.id === brandId);

    // Editing a tender that's already Won/Lost is a "locked" action — require a deliberate
    // confirmation so it can't be changed by accident.
    if (editing && (editing.stage === 'Won' || editing.stage === 'Lost')) {
      const confirmed = window.confirm(
        `"${editing.clientName}" is already marked ${editing.stage}. Are you sure you want to save changes to it?`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateTender(
          editing.id,
          {
            clientName: clientName.trim(),
            brandId,
            brandName: brand?.name || editing.brandName,
            department,
            contractStart,
            contractEnd,
            tenderValue: value,
            ownerUid,
            ownerName: owner.name,
            notes,
          },
          { uid: profile.uid, name: profile.name },
          editing
        );
        // stage changes go through the kanban drag; but allow explicit change here too
        if (stage !== editing.stage) {
          await moveTenderStage(
            { ...editing, tenderValue: value },
            stage,
            { uid: profile.uid, name: profile.name, role: profile.role },
            isClosedStage ? closedDate : undefined
          );
        } else if (isClosedStage && closedDate !== (editing.closedDate || '')) {
          // Stage didn't change, but they corrected/backfilled the won/lost date.
          await setClosedDate(editing, closedDate, { uid: profile.uid, name: profile.name });
        }
        // Submission date: independent of whether stage also changed above — covers a first-time
        // entry for a tender already sitting in Submitted, a first-time entry in the same save
        // that ALSO moves the stage into Submitted (moveTenderStage above never touches
        // submittedDate from this form path), and an admin's correction of an already-set value.
        // The field is fully disabled for a non-admin once a value exists (see the JSX below), so
        // a changed value can only ever reach here as either a first entry or an admin edit.
        if (showSubmittedField && submittedDate !== (editing.submittedDate || '')) {
          await setSubmittedDate(editing.id, submittedDate);
        }
      } else {
        await createTender(
          {
            clientName: clientName.trim(),
            brandId,
            brandName: brand?.name || '',
            department,
            contractStart,
            contractEnd,
            tenderValue: value,
            stage,
            ownerUid,
            ownerName: owner.name,
            notes,
            closedDate: isClosedStage ? closedDate : undefined,
            submittedDate: showSubmittedField ? submittedDate : undefined,
          },
          { uid: profile.uid, name: profile.name, role: profile.role }
        );
      }
      onClose();
    } catch (err) {
      console.error(err);
      setError('Something went wrong saving this tender. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!confirm(`Delete the tender for "${editing.clientName}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteTender(editing, { uid: profile.uid, name: profile.name });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Same action as the "Re-qualify" button on the Kanban card (see TenderCard.tsx) — repeated
  // here so a Disqualified Lead tender that's aged onto the Archive page (and so no longer has a
  // Kanban card at all) still has a way back into the pipeline instead of being stuck forever.
  const handleRequalify = async () => {
    if (!editing) return;
    if (!confirm(`Re-qualify "${editing.clientName}"? It will move back to New Lead and re-enter the pipeline from the top.`)) return;
    setSaving(true);
    try {
      await requalifyTender(editing, { uid: profile.uid, name: profile.name, role: profile.role });
      onClose();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not re-qualify this lead.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">
            {editing ? 'Edit Tender' : 'Register New Tender'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <Field label="Client Name">
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="input"
              placeholder="e.g. Petronas Chemicals Sdn Bhd"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand">
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="input">
                <option value="" disabled>
                  Select brand
                </option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select
                value={department}
                onChange={() => {}}
                className="input disabled:bg-slate-50 disabled:text-slate-500"
                disabled
              >
                {departmentOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-slate-400 mt-1">Set automatically from the tender owner.</span>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contract Start">
              <input
                type="date"
                value={contractStart}
                onChange={(e) => setContractStart(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Contract End">
              <input
                type="date"
                value={contractEnd}
                onChange={(e) => setContractEnd(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tender Value (RM)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={tenderValue}
                onChange={(e) => setTenderValue(e.target.value)}
                className="input"
                placeholder="0.00"
              />
            </Field>
            <Field label="Stage">
              {/* Disqualified Lead is sealed on both sides: never a dropdown target (so it can't
                  be picked casually), and — once a tender IS Disqualified Lead — locked read-only
                  here too, so the only way back out is the confirmed "Re-qualify" button on its
                  Kanban card (see requalifyTender() in services/tenders.ts). */}
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as Stage)}
                disabled={editing?.stage === 'Disqualified Lead'}
                className="input disabled:bg-slate-50 disabled:text-slate-500"
              >
                {(editing?.stage === 'Disqualified Lead'
                  ? (['Disqualified Lead'] as Stage[])
                  : STAGES.filter((s) => s !== 'Disqualified Lead')
                ).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {isClosedStage && (
            <Field label={`Date ${stage === 'Won' ? 'Won' : 'Lost'}`}>
              <input
                type="date"
                value={closedDate}
                onChange={(e) => setClosedDateField(e.target.value)}
                className="input"
              />
              <span className="block text-xs text-slate-400 mt-1">
                Use the real date this tender was {stage === 'Won' ? 'won' : 'lost'} — this is what
                the pipeline value trend chart uses, so it's safe to backdate for past deals.
              </span>
            </Field>
          )}

          {stage === 'Disqualified Lead' && editing?.disqualifiedDate && (
            <Field label="Disqualified on">
              <p className="text-sm text-slate-600">{formatDate(editing.disqualifiedDate)}</p>
              <span className="block text-xs text-slate-400 mt-1">
                Set automatically when this lead was disqualified. Stage can't be changed from
                here — use "Re-qualify" below (or its card in the Sales Funnel Pipeline) to send
                it back to New Lead instead.
              </span>
              <button
                type="button"
                onClick={handleRequalify}
                disabled={saving}
                className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-60"
              >
                Re-qualify
              </button>
            </Field>
          )}

          {showSubmittedField && (
            <Field label="Submission Date">
              {submittedDateAlreadySet && !isAdmin ? (
                <>
                  <input type="text" value={formatDate(editing?.submittedDate)} disabled className="input disabled:bg-slate-50 disabled:text-slate-500" />
                  <span className="block text-xs text-slate-400 mt-1">
                    Locked after first entry — ask your Admin if this needs to change.
                  </span>
                </>
              ) : (
                <>
                  <input
                    type="date"
                    value={submittedDate}
                    max={today()}
                    onChange={(e) => setSubmittedDateField(e.target.value)}
                    className="input"
                  />
                  <span className="block text-xs text-slate-400 mt-1">
                    {submittedDateAlreadySet
                      ? 'Already set — as Admin you can correct it if needed.'
                      : "The date this tender was submitted to the client — can't be a future date, and can only be entered once."}
                  </span>
                </>
              )}
            </Field>
          )}

          <Field label="Tender Owner">
            <select
              value={ownerUid}
              onChange={(e) => {
                const uid = e.target.value;
                if (uid === ownerUid) return;
                const owner = staffOptions.find((s) => s.uid === uid);
                const newOwnerName = owner ? owner.name : uid;
                // Only ask for confirmation when reassigning an EXISTING tender — picking the
                // initial owner while registering a brand-new one is just filling out the form,
                // nothing to confirm yet (mirrors the same "confirm on change, not on create"
                // pattern UserManager.tsx uses for role/department changes).
                if (editing) {
                  const currentOwnerName =
                    staffOptions.find((s) => s.uid === ownerUid)?.name || editing.ownerName;
                  const confirmed = window.confirm(
                    `Reassign "${editing.clientName}" from ${currentOwnerName} to ${newOwnerName}? ` +
                      `This also moves it to ${newOwnerName}'s department, and they'll be able to see and nurture it through the pipeline from here on.`
                  );
                  if (!confirmed) return;
                }
                setOwnerUid(uid);
                // Department always follows the owner — reassigning the owner reassigns the
                // department too, so the two can never drift apart.
                if (owner) setDepartment(owner.department);
              }}
              className="input"
              disabled={!isAdmin}
            >
              {isAdmin ? (
                staffOptions.map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name}
                  </option>
                ))
              ) : (
                <option value={profile.uid}>{profile.name}</option>
              )}
            </select>
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input min-h-[70px] resize-y"
              placeholder="Any context about this tender…"
            />
          </Field>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <div>
              {/* Admin-only — owners no longer get to delete their own tenders, so every tender is
                  forced to move through the pipeline (Won/Lost/Disqualified Lead) instead of
                  being able to disappear, keeping the funnel's history and analytics accurate.
                  Admin retains it as a deliberate override for genuine data cleanup. */}
              {editing && isAdmin && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-xs font-medium text-rose-500 hover:text-rose-700"
                >
                  Delete tender
                </button>
              )}
            </div>
            <div className="flex gap-2">
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
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Tender'}
              </button>
            </div>
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
