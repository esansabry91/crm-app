import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Role, Tender } from '../../types';
import {
  addTenderEquipment,
  removeTenderEquipmentItem,
  updateActiveProjectDetails,
  wholeMonthsInclusive,
} from '../../services/tenders';
import { formatDate } from '../../utils/format';
import {
  deleteTenderDocument,
  openTenderDocument,
  uploadTenderDocument,
  type TenderDocumentInfo,
} from '../../services/tenderDocuments';

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
  /** Needed for the Additional Equipment section below — addTenderEquipment()/
   *  removeTenderEquipmentItem() log a history entry attributed to whoever's making the change,
   *  same as RenewContractModal's own actor prop. */
  actor: { uid: string; name: string; role?: Role };
}

/**
 * Lets anyone who can see a project in Active Projects (its branch-mates, HQ, or admin — the
 * same audience Firestore's read rule allows) fill in the operational details that aren't part
 * of the sales record: worksite location (state, city, postcode included), an on-site/client
 * contact, how many guards are currently deployed, the tender document reference number, a
 * client alias/short code and billing address (both read by the Branch Collection tab's invoice
 * generator — see Tender.clientAlias's doc comment in types.ts), and how permanent guards on this
 * project's Duty Roster site bill the client per man-hour (see Tender.guardRateMode's own doc
 * comment in types.ts — read live from the Duty Roster's Summary Report, never snapshotted).
 * Deliberately separate from TenderFormModal — that one edits the sales record and is locked to
 * the owner/admin; this one edits only these fields, which the Firestore rules allow more people
 * to touch. Every field is required before Save will submit — see handleSave — except Security
 * Guards Deployed once it's roster-driven (see the liveGuardCount prop doc comment), Tender
 * Document No., Client Alias and Client Billing Address (often not filled in yet when these
 * details are first entered), and the Guard Rate section, which is optional since a rate may get
 * finalized separately from the rest of a project's details.
 */
export default function ProjectDetailsModal({ open, onClose, tender, liveGuardCount, actor }: Props) {
  const [location, setLocation] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [guardsDeployed, setGuardsDeployed] = useState('');
  const [tenderDocNumber, setTenderDocNumber] = useState('');
  const [scopeOfWork, setScopeOfWork] = useState('');
  const [clientAlias, setClientAlias] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [rateMode, setRateMode] = useState<'same' | 'multiple'>('same');
  const [flatRate, setFlatRate] = useState('');
  const [positions, setPositions] = useState<{ name: string; rate: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tender document (PDF) upload — deliberately independent of the Save button below: it
  // uploads/deletes immediately via the Worker (see services/tenderDocuments.ts), which writes
  // straight to Firestore itself, rather than being staged here and only sent on Save like every
  // other field in this form.
  const [docInfo, setDocInfo] = useState<TenderDocumentInfo | null>(null);
  const [docBusy, setDocBusy] = useState<'idle' | 'uploading' | 'opening' | 'deleting'>('idle');
  const [docError, setDocError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Additional Equipment (see TenderEquipmentItem's doc comment in types.ts) — saves immediately
  // per item, like the tender document upload/delete above, rather than being staged until this
  // form's own "Save Details" button (which never touches tenderValue/additionalEquipment).
  // `workingTender` is a locally-refreshed copy of the `tender` prop: the prop itself is a
  // point-in-time snapshot the parent page took when this modal was opened (see
  // ActiveProjectsPage's detailsTender), so without this, adding a SECOND item in the same modal
  // session would compute its value bump against a stale tenderValue instead of the one the
  // first add just wrote.
  const [workingTender, setWorkingTender] = useState<Tender | null>(null);
  const [eqItem, setEqItem] = useState('');
  const [eqRate, setEqRate] = useState('');
  const [eqQty, setEqQty] = useState('');
  const [eqStartDate, setEqStartDate] = useState('');
  const [eqBusy, setEqBusy] = useState<string | null>(null); // 'add', an item id being removed, or null
  const [eqError, setEqError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tender) return;
    setLocation(tender.location || '');
    setStateName(tender.state || '');
    setCity(tender.city || '');
    setPostcode(tender.postcode || '');
    setContactPerson(tender.contactPerson || '');
    setGuardsDeployed(tender.guardsDeployed != null ? String(tender.guardsDeployed) : '');
    setTenderDocNumber(tender.tenderDocNumber || '');
    setScopeOfWork(tender.scopeOfWork || '');
    setDocInfo(
      tender.tenderDocumentName && tender.tenderDocumentUploadedAt
        ? {
            tenderDocumentName: tender.tenderDocumentName,
            tenderDocumentSize: tender.tenderDocumentSize || 0,
            tenderDocumentUploadedAt: tender.tenderDocumentUploadedAt,
          }
        : null
    );
    setDocError(null);
    setClientAlias(tender.clientAlias || '');
    setClientAddress(tender.clientAddress || '');
    setWorkingTender(tender);
    setEqItem('');
    setEqRate('');
    setEqQty('');
    const todayStr = new Date().toISOString().slice(0, 10);
    setEqStartDate(tender.contractStart && tender.contractStart > todayStr ? tender.contractStart : todayStr);
    setEqError(null);
    setRateMode(tender.guardRateMode === 'multiple' ? 'multiple' : 'same');
    setFlatRate(tender.guardRate != null ? String(tender.guardRate) : '');
    setPositions(
      tender.guardRatePositions && tender.guardRatePositions.length
        ? tender.guardRatePositions.map((p) => ({ name: p.name, rate: String(p.rate) }))
        : []
    );
    setError(null);
  }, [open, tender]);

  if (!open || !tender) return null;

  const handleUploadDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later (e.g. after a failed upload)
    if (!file || !tender) return;
    setDocError(null);
    setDocBusy('uploading');
    try {
      const info = await uploadTenderDocument(tender.id, file);
      setDocInfo(info);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not upload the document.');
    } finally {
      setDocBusy('idle');
    }
  };

  const handleOpenDocument = async () => {
    if (!tender) return;
    setDocError(null);
    setDocBusy('opening');
    try {
      await openTenderDocument(tender.id);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not open the document.');
    } finally {
      setDocBusy('idle');
    }
  };

  const handleDeleteDocument = async () => {
    if (!tender) return;
    if (!window.confirm('Remove the uploaded tender document? This cannot be undone.')) return;
    setDocError(null);
    setDocBusy('deleting');
    try {
      await deleteTenderDocument(tender.id);
      setDocInfo(null);
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Could not delete the document.');
    } finally {
      setDocBusy('idle');
    }
  };

  // Re-reads the tender doc after a write below so a second add/remove in the same modal
  // session computes against the value the FIRST one just wrote, not the stale prop — see
  // workingTender's own doc comment above.
  const refreshWorkingTender = async () => {
    if (!tender) return;
    const snap = await getDoc(doc(db, 'tenders', tender.id));
    if (snap.exists()) setWorkingTender({ id: snap.id, ...(snap.data() as Omit<Tender, 'id'>) });
  };

  const handleAddEquipment = async () => {
    const activeTender = workingTender || tender;
    if (!activeTender) return;
    setEqError(null);
    const name = eqItem.trim();
    const rate = Number(eqRate);
    const qty = Number(eqQty);
    if (!name) { setEqError('Enter the equipment name.'); return; }
    if (!Number.isFinite(rate) || rate < 0) { setEqError('Enter a valid monthly rate.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setEqError('Enter a valid quantity.'); return; }
    if (!eqStartDate) { setEqError('Pick a start date.'); return; }
    setEqBusy('add');
    try {
      await addTenderEquipment(
        activeTender,
        { item: name, monthlyRate: rate, quantity: qty, startDate: eqStartDate },
        actor
      );
      await refreshWorkingTender();
      setEqItem('');
      setEqRate('');
      setEqQty('');
      setEqStartDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Could not add this equipment item.');
    } finally {
      setEqBusy(null);
    }
  };

  const handleRemoveEquipment = async (itemId: string, label: string) => {
    const activeTender = workingTender || tender;
    if (!activeTender) return;
    if (
      !window.confirm(
        `Remove "${label}" from this project's Additional Equipment? This reverses the value it added to this project's tracked contract value.`
      )
    ) {
      return;
    }
    setEqError(null);
    setEqBusy(itemId);
    try {
      await removeTenderEquipmentItem(activeTender, itemId, actor);
      await refreshWorkingTender();
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Could not remove this equipment item.');
    } finally {
      setEqBusy(null);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Every field on this form is required before it can be saved, except Tender Document No.
    // (often not issued yet) and the Guard Rate section below.
    if (!location.trim()) { setError('Location is required.'); return; }
    if (!stateName.trim()) { setError('State is required.'); return; }
    if (!city.trim()) { setError('City is required.'); return; }
    if (!postcode.trim()) { setError('Postcode is required.'); return; }
    if (!contactPerson.trim()) { setError('Contact Person is required.'); return; }

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

    // Guard Rate is the one optional section here — only written when something's actually
    // been filled in, so an untouched project simply stays "not configured" (see
    // Tender.guardRateMode's doc comment) rather than getting stamped with a meaningless RM 0.00.
    let rateFields: Partial<{
      guardRateMode: 'same' | 'multiple';
      guardRate: number;
      guardRatePositions: { name: string; rate: number }[];
    }> = {};
    if (rateMode === 'same') {
      if (flatRate.trim() !== '') {
        const rateNum = Number(flatRate);
        if (!Number.isFinite(rateNum) || rateNum < 0) {
          setError('Enter a valid rate (RM per man-hour), or leave it blank.');
          return;
        }
        rateFields = { guardRateMode: 'same', guardRate: rateNum, guardRatePositions: [] };
      }
    } else {
      const filledRows = positions.filter((p) => p.name.trim() !== '' || p.rate.trim() !== '');
      if (filledRows.length > 0) {
        const parsedPositions: { name: string; rate: number }[] = [];
        for (const p of filledRows) {
          if (!p.name.trim()) { setError('Each position needs a name.'); return; }
          const rateNum = Number(p.rate);
          if (!Number.isFinite(rateNum) || rateNum < 0) {
            setError(`Enter a valid rate for "${p.name.trim()}".`);
            return;
          }
          parsedPositions.push({ name: p.name.trim(), rate: rateNum });
        }
        rateFields = { guardRateMode: 'multiple', guardRatePositions: parsedPositions };
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
        scopeOfWork: scopeOfWork.trim(),
        clientAlias: clientAlias.trim(),
        clientAddress: clientAddress.trim(),
        ...(guards !== undefined ? { guardsDeployed: guards } : {}),
        ...rateFields,
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

          <Field label="Scope of Work">
            <textarea
              value={scopeOfWork}
              onChange={(e) => setScopeOfWork(e.target.value)}
              className="input"
              rows={3}
              placeholder="Summarize what the contract covers — posts, shifts, duties, etc."
            />
          </Field>

          <Field label="Tender Document (PDF)">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              onChange={handleUploadDocument}
              className="hidden"
            />
            {docInfo ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleOpenDocument}
                  disabled={docBusy !== 'idle'}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-60 truncate max-w-[180px]"
                  title={docInfo.tenderDocumentName}
                >
                  📄 {docInfo.tenderDocumentName}
                </button>
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
                  {formatFileSize(docInfo.tenderDocumentSize)}
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={docBusy !== 'idle'}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-60"
                >
                  {docBusy === 'uploading' ? 'Replacing…' : 'Replace'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteDocument}
                  disabled={docBusy !== 'idle'}
                  className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-60"
                >
                  {docBusy === 'deleting' ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={docBusy !== 'idle'}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 disabled:opacity-60"
              >
                {docBusy === 'uploading' ? 'Uploading…' : '+ Upload PDF'}
              </button>
            )}
            {docError && <p className="text-xs text-rose-600 mt-1">{docError}</p>}
          </Field>

          <Field label="Client Alias / Short Code (for invoice numbers)">
            <input
              value={clientAlias}
              onChange={(e) => setClientAlias(e.target.value)}
              className="input"
              placeholder="e.g. MDEC"
            />
          </Field>

          <Field label="Client Billing Address">
            <textarea
              value={clientAddress}
              onChange={(e) => setClientAddress(e.target.value)}
              className="input"
              rows={2}
              placeholder="Printed on invoices, if different from the worksite location above"
            />
          </Field>

          <div className="pt-2 border-t border-slate-100">
            <p className="block text-xs font-medium text-slate-500 mb-2">
              Guard Rate{' '}
              <span className="text-slate-400 font-normal">
                (optional — bills the client per man-hour worked, read live by the Duty Roster's
                Summary Report)
              </span>
            </p>

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setRateMode('same')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                  rateMode === 'same'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Same rate for all
              </button>
              <button
                type="button"
                onClick={() => setRateMode('multiple')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                  rateMode === 'multiple'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Multiple rates by position
              </button>
            </div>

            {rateMode === 'same' ? (
              <Field label="Rate (RM per man-hour)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={flatRate}
                  onChange={(e) => setFlatRate(e.target.value)}
                  className="input"
                  placeholder="e.g. 8.50"
                />
              </Field>
            ) : (
              <div className="space-y-2">
                {positions.map((p, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <input
                      value={p.name}
                      onChange={(e) => {
                        const next = [...positions];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setPositions(next);
                      }}
                      className="input flex-1"
                      placeholder="e.g. Leader"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={p.rate}
                      onChange={(e) => {
                        const next = [...positions];
                        next[idx] = { ...next[idx], rate: e.target.value };
                        setPositions(next);
                      }}
                      className="input w-24"
                      placeholder="RM/hr"
                    />
                    <button
                      type="button"
                      onClick={() => setPositions(positions.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-600 text-lg leading-none px-1 pt-1.5"
                      aria-label={`Remove ${p.name || 'position'}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPositions([...positions, { name: '', rate: '' }])}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  + Add position
                </button>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="block text-xs font-medium text-slate-500 mb-2">
              Additional Equipment{' '}
              <span className="text-slate-400 font-normal">
                (optional — e-bikes, drones and similar, billed alongside guard headcount; add an
                item from day one of the contract or mid-way through it)
              </span>
            </p>

            {(() => {
              const activeTender = workingTender || tender;
              const items = [...(activeTender.additionalEquipment || [])].sort((a, b) =>
                a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0
              );
              const previewRate = Number(eqRate) || 0;
              const previewQty = Number(eqQty) || 0;
              const previewStart =
                eqStartDate && eqStartDate < activeTender.contractStart
                  ? activeTender.contractStart
                  : eqStartDate;
              const previewMonths = previewStart
                ? wholeMonthsInclusive(previewStart, activeTender.contractEnd)
                : 0;
              const previewValue = previewRate * previewQty * previewMonths;

              return (
                <>
                  {items.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {items.map((eq) => (
                        <div key={eq.id} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-700 font-medium">{eq.item}</span>{' '}
                            <span className="text-slate-500">
                              RM {eq.monthlyRate.toFixed(2)} × {eq.quantity} / month, from {formatDate(eq.startDate)}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400 whitespace-nowrap">
                            +RM {eq.valueContribution.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveEquipment(eq.id, eq.item)}
                            disabled={eqBusy !== null}
                            className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-60 shrink-0"
                          >
                            {eqBusy === eq.id ? 'Removing…' : 'Remove'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={eqItem}
                        onChange={(e) => setEqItem(e.target.value)}
                        placeholder="e.g. E-bike"
                        className="input flex-1"
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={eqRate}
                        onChange={(e) => setEqRate(e.target.value)}
                        placeholder="RM/month"
                        className="input w-24"
                      />
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={eqQty}
                        onChange={(e) => setEqQty(e.target.value)}
                        placeholder="Qty"
                        className="input w-16"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={eqStartDate}
                        min={activeTender.contractStart || undefined}
                        max={activeTender.contractEnd || undefined}
                        onChange={(e) => setEqStartDate(e.target.value)}
                        className="input"
                      />
                      <button
                        type="button"
                        onClick={handleAddEquipment}
                        disabled={eqBusy !== null}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-60 whitespace-nowrap"
                      >
                        {eqBusy === 'add' ? 'Adding…' : '+ Add equipment'}
                      </button>
                    </div>
                    {eqItem.trim() && eqRate.trim() && eqQty.trim() && eqStartDate && (
                      <p className="text-[11px] text-slate-400">
                        Adds an estimated RM {previewValue.toFixed(2)} to this project's tracked contract
                        value ({previewMonths} month{previewMonths === 1 ? '' : 's'} remaining from{' '}
                        {formatDate(previewStart)} to contract end).
                      </p>
                    )}
                    {eqError && <p className="text-xs text-rose-600">{eqError}</p>}
                  </div>
                </>
              );
            })()}
          </div>

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

function formatFileSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
