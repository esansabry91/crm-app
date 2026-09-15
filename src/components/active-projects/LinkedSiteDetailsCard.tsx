import { useEffect, useState } from 'react';
import type { Role, Tender } from '../../types';
import {
  addTenderSiteEquipment,
  applyTenderSiteGuardRateChange,
  effectiveGuardRate,
  removeTenderSiteEquipmentItem,
  saveTenderSiteLocationDetails,
  STANDARD_MONTHLY_HOURS_PER_GUARD,
  stopTenderSiteEquipmentItem,
  wholeMonthsInclusive,
} from '../../services/tenders';
import { formatDate, formatDateTime } from '../../utils/format';
import type { TenderLinkedSite } from '../../hooks/useTenderSites';

interface Props {
  tender: Tender;
  site: TenderLinkedSite;
  actor: { uid: string; name: string; role?: Role };
}

/**
 * One additional linked Duty Roster site's own Location/Contact/Guard Rate/Additional Equipment
 * — the per-site counterpart of the fields ProjectDetailsModal.tsx already shows for a project's
 * first/original site (which keep living on the Tender document itself). See TenderSiteDetails'
 * doc comment in types.ts for why a second-or-later site gets its own
 * tenders/{tenderId}/siteDetails/{siteId} doc instead of sharing those top-level fields.
 *
 * Collapsed by default (a project with several extra sites shouldn't dump every one of their
 * full forms open at once) — click the header to expand. Location/Contact/Guard Rate share one
 * "Save site details" button, matching the parent form's own Save Details button; Additional
 * Equipment saves immediately on Add/Stop/Remove, matching the parent's own equipment list.
 */
export default function LinkedSiteDetailsCard({ tender, site, actor }: Props) {
  const [expanded, setExpanded] = useState(false);
  const details = site.details;

  const [location, setLocation] = useState('');
  const [stateName, setStateName] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [rateMode, setRateMode] = useState<'same' | 'multiple'>('same');
  const [flatRate, setFlatRate] = useState('');
  const [positions, setPositions] = useState<{ name: string; rate: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [eqItem, setEqItem] = useState('');
  const [eqRate, setEqRate] = useState('');
  const [eqQty, setEqQty] = useState('');
  const [eqStartDate, setEqStartDate] = useState('');
  const [eqBusy, setEqBusy] = useState<string | null>(null);
  const [eqError, setEqError] = useState<string | null>(null);
  const [stoppingItemId, setStoppingItemId] = useState<string | null>(null);
  const [stopDateDraft, setStopDateDraft] = useState('');

  useEffect(() => {
    setLocation(details?.location || '');
    setStateName(details?.state || '');
    setCity(details?.city || '');
    setPostcode(details?.postcode || '');
    setContactPerson(details?.contactPerson || '');
    setRateMode(details?.guardRateMode || 'same');
    setFlatRate(details?.guardRate != null ? String(details.guardRate) : '');
    setPositions(details?.guardRatePositions?.map((p) => ({ name: p.name, rate: String(p.rate) })) || []);
    setError(null);
    setEqError(null);
    setStoppingItemId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, details === null]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveTenderSiteLocationDetails(tender.id, site.id, site.name, site.branch, {
        location: location.trim(),
        state: stateName.trim(),
        city: city.trim(),
        postcode: postcode.trim(),
        contactPerson: contactPerson.trim(),
      });

      const wantsRate =
        rateMode === 'same' ? flatRate.trim() !== '' : positions.some((p) => p.name.trim() !== '' && p.rate.trim() !== '');
      if (wantsRate) {
        await applyTenderSiteGuardRateChange(
          tender,
          site.id,
          site.name,
          site.branch,
          details,
          {
            guardRateMode: rateMode,
            guardRate: rateMode === 'same' ? Number(flatRate) || 0 : undefined,
            guardRatePositions:
              rateMode === 'multiple'
                ? positions
                    .filter((p) => p.name.trim() !== '' && p.rate.trim() !== '')
                    .map((p) => ({ name: p.name.trim(), rate: Number(p.rate) || 0 }))
                : undefined,
            guardsDeployed: site.activeGuardCount,
          },
          actor
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save site details.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddEquipment = async () => {
    setEqError(null);
    if (!eqItem.trim() || !eqRate.trim() || !eqQty.trim() || !eqStartDate) {
      setEqError('Fill in item, rate, quantity and start date.');
      return;
    }
    setEqBusy('add');
    try {
      await addTenderSiteEquipment(
        tender,
        site.id,
        site.name,
        site.branch,
        details,
        { item: eqItem.trim(), monthlyRate: Number(eqRate) || 0, quantity: Number(eqQty) || 0, startDate: eqStartDate },
        actor
      );
      setEqItem('');
      setEqRate('');
      setEqQty('');
      setEqStartDate('');
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Failed to add equipment.');
    } finally {
      setEqBusy(null);
    }
  };

  const handleConfirmStop = async (itemId: string) => {
    if (!details || !stopDateDraft) return;
    setEqBusy(`stop-${itemId}`);
    setEqError(null);
    try {
      await stopTenderSiteEquipmentItem(tender, site.id, details, itemId, stopDateDraft, actor);
      setStoppingItemId(null);
      setStopDateDraft('');
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Failed to stop equipment item.');
    } finally {
      setEqBusy(null);
    }
  };

  const handleRemoveEquipment = async (itemId: string, label: string) => {
    if (!details) return;
    if (!window.confirm(`Remove "${label}" from ${site.name}'s Additional Equipment? This reverses the value it added to this project's tracked contract value.`)) {
      return;
    }
    setEqBusy(itemId);
    setEqError(null);
    try {
      await removeTenderSiteEquipmentItem(tender, site.id, details, itemId, actor);
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Failed to remove equipment item.');
    } finally {
      setEqBusy(null);
    }
  };

  const items = [...(details?.additionalEquipment || [])].sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0
  );

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left"
      >
        <span className="text-sm font-medium text-slate-700">
          {site.name}
          {site.branch && <span className="text-slate-400 font-normal"> · {site.branch}</span>}
        </span>
        <span className="text-xs text-slate-400">
          {site.activeGuardCount} guard{site.activeGuardCount === 1 ? '' : 's'} {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="p-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder="Worksite address" />
            </Field>
            <Field label="Contact Person">
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input" />
            </Field>
            <Field label="State">
              <input value={stateName} onChange={(e) => setStateName(e.target.value)} className="input" />
            </Field>
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
            </Field>
            <Field label="Postcode">
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)} className="input" />
            </Field>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Guard Rate</p>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setRateMode('same')}
                className={`px-2 py-1 text-xs rounded-lg border ${rateMode === 'same' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
              >
                Same rate for all
              </button>
              <button
                type="button"
                onClick={() => setRateMode('multiple')}
                className={`px-2 py-1 text-xs rounded-lg border ${rateMode === 'multiple' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
              >
                By position
              </button>
            </div>
            {rateMode === 'same' ? (
              <input
                type="number"
                min={0}
                step="0.01"
                value={flatRate}
                onChange={(e) => setFlatRate(e.target.value)}
                className="input"
                placeholder="RM per man-hour"
              />
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
            {details?.lastGuardRateChange && (
              <p className="text-[11px] text-slate-400 mt-2">
                Rate last changed from RM {details.lastGuardRateChange.fromRate.toFixed(2)} to RM{' '}
                {details.lastGuardRateChange.toRate.toFixed(2)} on {formatDateTime(details.lastGuardRateChange.changedAt)} by{' '}
                {details.lastGuardRateChange.changedByName}.
              </p>
            )}
            {(() => {
              if (details?.guardRateMode == null) return null;
              const oldEffective = effectiveGuardRate(details.guardRateMode, details.guardRate, details.guardRatePositions);
              let newEffective: number | null = null;
              if (rateMode === 'same' && flatRate.trim() !== '') {
                const n = Number(flatRate);
                if (Number.isFinite(n)) newEffective = n;
              } else if (rateMode === 'multiple') {
                const filled = positions.filter((p) => p.name.trim() !== '' && p.rate.trim() !== '');
                if (filled.length > 0) {
                  const sum = filled.reduce((s, p) => s + Number(p.rate), 0);
                  if (Number.isFinite(sum)) newEffective = sum / filled.length;
                }
              }
              if (newEffective == null || newEffective === oldEffective) return null;
              const months = wholeMonthsInclusive(new Date().toISOString().slice(0, 10), tender.contractEnd);
              const delta = (newEffective - oldEffective) * STANDARD_MONTHLY_HOURS_PER_GUARD * site.activeGuardCount * months;
              if (delta === 0) return null;
              return (
                <p className="text-[11px] text-slate-400 mt-2">
                  {delta > 0 ? 'Adds an estimated' : 'Removes an estimated'} RM {Math.abs(delta).toFixed(2)} to this
                  project's tracked contract value (assumes {STANDARD_MONTHLY_HOURS_PER_GUARD} hrs/guard/month ×{' '}
                  {site.activeGuardCount} guard{site.activeGuardCount === 1 ? '' : 's'} × {months} month{months === 1 ? '' : 's'} remaining).
                </p>
              );
            })()}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-2">
              Additional Equipment <span className="text-slate-400 font-normal">(optional)</span>
            </p>
            {items.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {items.map((eq) => (
                  <div key={eq.id} className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-700 font-medium">{eq.item}</span>{' '}
                        <span className="text-slate-500">
                          RM {eq.monthlyRate.toFixed(2)} × {eq.quantity} / month, from {formatDate(eq.startDate)}
                        </span>
                        {eq.stoppedDate && <span className="text-amber-600"> · stopped {formatDate(eq.stoppedDate)}</span>}
                      </div>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        +RM {eq.valueContribution.toFixed(2)}
                        {eq.stopValueReversal ? ` (−RM ${eq.stopValueReversal.toFixed(2)})` : ''}
                      </span>
                      {!eq.stoppedDate && (
                        <button
                          type="button"
                          onClick={() => {
                            setStoppingItemId(eq.id);
                            setStopDateDraft(eq.startDate < tender.contractEnd ? eq.startDate : tender.contractEnd);
                          }}
                          disabled={eqBusy !== null}
                          className="text-xs font-medium text-amber-600 hover:text-amber-700 disabled:opacity-60 shrink-0"
                        >
                          Stop
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveEquipment(eq.id, eq.item)}
                        disabled={eqBusy !== null}
                        className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-60 shrink-0"
                      >
                        {eqBusy === eq.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                    {stoppingItemId === eq.id && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                        <input
                          type="date"
                          value={stopDateDraft}
                          min={eq.startDate}
                          max={tender.contractEnd || undefined}
                          onChange={(e) => setStopDateDraft(e.target.value)}
                          className="input flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => handleConfirmStop(eq.id)}
                          disabled={eqBusy !== null}
                          className="px-2 py-1 text-xs font-medium rounded-lg border bg-white text-amber-700 border-amber-200 hover:bg-amber-50 disabled:opacity-60 whitespace-nowrap"
                        >
                          {eqBusy === `stop-${eq.id}` ? 'Stopping…' : 'Confirm stop'}
                        </button>
                        <button type="button" onClick={() => setStoppingItemId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={eqItem} onChange={(e) => setEqItem(e.target.value)} placeholder="e.g. E-bike" className="input flex-1" />
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
                  min={tender.contractStart || undefined}
                  max={tender.contractEnd || undefined}
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
              {eqError && <p className="text-xs text-rose-600">{eqError}</p>}
            </div>
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save site details'}
            </button>
          </div>
        </div>
      )}
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
