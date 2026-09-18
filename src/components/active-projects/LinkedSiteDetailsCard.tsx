import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Role, Tender } from '../../types';
import {
  addTenderSiteEquipment,
  applyTenderSiteGuardRateChange,
  archiveTenderSite,
  effectiveGuardRate,
  removeTenderSite,
  removeTenderSiteEquipmentItem,
  saveTenderSiteLocationDetails,
  STANDARD_MONTHLY_HOURS_PER_GUARD,
  stopTenderSiteEquipmentItem,
  wholeMonthsInclusive,
} from '../../services/tenders';
import { formatDate, formatDateTime } from '../../utils/format';
import type { TenderLinkedSite } from '../../hooks/useTenderSites';
import { useBranches } from '../../hooks/useBranches';

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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const details = site.details;
  const { branches } = useBranches();

  // Which branch actually runs this site day to day — editable here (unlike at creation time,
  // there's no separate "+ Add Site" form to change it in) so a project owner can re-delegate an
  // already-linked site to a different branch, or reclaim it, later on. '' means Unassigned
  // (visible to every branch — see firestore.rules' canReachSite()), matching Duty Roster's own
  // "assign to branch" picker convention.
  const [branch, setBranch] = useState('');

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

  // Archive/Remove (see archiveTenderSite()/removeTenderSite()'s own doc comments in
  // services/tenders.ts) — kept as their own busy/error state, separate from the main form's
  // `saving`/`error` above, so a lifecycle action never gets stuck showing "Saving..." on the
  // main Save button or vice versa.
  const [lifecycleBusy, setLifecycleBusy] = useState<'archive' | 'remove' | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  useEffect(() => {
    setBranch(site.branch || '');
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

  const handleToggleArchive = async () => {
    setLifecycleBusy('archive');
    setLifecycleError(null);
    try {
      await archiveTenderSite(site.id, !site.archived);
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : t('linkedSiteCard.errorUpdateSite'));
    } finally {
      setLifecycleBusy(null);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t('linkedSiteCard.confirmRemoveSite', { name: site.name }))) {
      return;
    }
    setLifecycleBusy('remove');
    setLifecycleError(null);
    try {
      await removeTenderSite(site.id);
      // No busy-state reset on success: this site drops out of useTenderSites()'s live query
      // (it no longer matches tenderId) the instant the write lands, so this card unmounts
      // before it would ever re-render with lifecycleBusy still set — resetting it here would
      // just be a setState-after-unmount warning waiting to happen.
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : t('linkedSiteCard.errorRemoveSite'));
      setLifecycleBusy(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const branchValue = branch.trim() || null;
      await saveTenderSiteLocationDetails(tender.id, site.id, site.name, branchValue, tender.clientName, {
        location: location.trim(),
        state: stateName.trim(),
        city: city.trim(),
        postcode: postcode.trim(),
        contactPerson: contactPerson.trim(),
        // setDoc()/updateDoc() reject `undefined` field values outright (this project
        // doesn't set ignoreUndefinedProperties) — these three are optional on Tender, so an
        // older/incomplete project without them would otherwise throw here.
        clientAlias: tender.clientAlias || null,
        clientAddress: tender.clientAddress || null,
        tenderDocNumber: tender.tenderDocNumber || null,
        brandId: tender.brandId,
      });

      const wantsRate =
        rateMode === 'same' ? flatRate.trim() !== '' : positions.some((p) => p.name.trim() !== '' && p.rate.trim() !== '');
      if (wantsRate) {
        await applyTenderSiteGuardRateChange(
          tender,
          site.id,
          site.name,
          branchValue,
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
      setError(err instanceof Error ? err.message : t('linkedSiteCard.errorSaveSiteDetails'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddEquipment = async () => {
    setEqError(null);
    if (!eqItem.trim() || !eqRate.trim() || !eqQty.trim() || !eqStartDate) {
      setEqError(t('linkedSiteCard.errorFillEquipmentFields'));
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
      setEqError(err instanceof Error ? err.message : t('linkedSiteCard.errorAddEquipment'));
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
      setEqError(err instanceof Error ? err.message : t('linkedSiteCard.errorStopEquipment'));
    } finally {
      setEqBusy(null);
    }
  };

  const handleRemoveEquipment = async (itemId: string, label: string) => {
    if (!details) return;
    if (!window.confirm(t('linkedSiteCard.confirmRemoveEquipment', { label, site: site.name }))) {
      return;
    }
    setEqBusy(itemId);
    setEqError(null);
    try {
      await removeTenderSiteEquipmentItem(tender, site.id, details, itemId, actor);
    } catch (err) {
      setEqError(err instanceof Error ? err.message : t('linkedSiteCard.errorRemoveEquipment'));
    } finally {
      setEqBusy(null);
    }
  };

  const items = [...(details?.additionalEquipment || [])].sort((a, b) =>
    a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0
  );

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex-1 text-left">
          <span className="text-sm font-medium text-slate-700">
            {site.name}
            {site.branch && <span className="text-slate-400 font-normal"> · {site.branch}</span>}
            {site.archived && <span className="text-amber-600 font-normal text-xs ml-1.5">{t('linkedSiteCard.archivedLabel')}</span>}
          </span>
        </button>
        <div className="flex items-center gap-3">
          {/* Deep-links straight to this exact site in the Duty Roster console (see the
              siteId deep-link handling in public/duty-roster/index.html) — the tender-level
              "Duty Roster" tab link in ActiveProjectsPage.tsx only ever reaches this project's
              primary/first site, so this is the only way to open an ADDITIONAL site's own
              roster directly rather than hunting for it via the sitebar's Client Site filter. */}
          <Link
            to={`/duty-roster?tenderId=${encodeURIComponent(tender.id)}&siteId=${encodeURIComponent(site.id)}&clientName=${encodeURIComponent(tender.clientName)}&branch=${encodeURIComponent(site.branch || tender.activeBranch || tender.department || '')}`}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            {t('linkedSiteCard.dutyRosterLink')}
          </Link>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-slate-400"
          >
            {t('projectDetails.guardsUnit', { count: site.activeGuardCount })} {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-4">
          <Field label={t('projectDetails.managingBranch')}>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="input">
              <option value="">{t('linkedSiteCard.unassignedVisibleToAll')}</option>
              {/* Shows the site's actual current value even if it's since been renamed/removed
                  from the branches list — so it displays accurately (rather than silently
                  falling back to "Unassigned" in the dropdown) and isn't accidentally cleared
                  the next time someone saves this form without touching this field. */}
              {branch && !branches.some((b) => b.name === branch) && (
                <option value={branch}>{t('linkedSiteCard.notInBranchList', { branch })}</option>
              )}
              {branches.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {t('linkedSiteCard.managingBranchHint')}
            </p>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('projectDetails.location')}>
              <input value={location} onChange={(e) => setLocation(e.target.value)} className="input" placeholder={t('projectDetails.locationPlaceholder')} />
            </Field>
            <Field label={t('projectDetails.contactPerson')}>
              <input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="input" />
            </Field>
            <Field label={t('projectDetails.state')}>
              <input value={stateName} onChange={(e) => setStateName(e.target.value)} className="input" />
            </Field>
            <Field label={t('projectDetails.city')}>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
            </Field>
            <Field label={t('projectDetails.postcode')}>
              <input value={postcode} onChange={(e) => setPostcode(e.target.value)} className="input" />
            </Field>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">{t('projectDetails.guardRate')}</p>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setRateMode('same')}
                className={`px-2 py-1 text-xs rounded-lg border ${rateMode === 'same' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
              >
                {t('projectDetails.sameRateForAll')}
              </button>
              <button
                type="button"
                onClick={() => setRateMode('multiple')}
                className={`px-2 py-1 text-xs rounded-lg border ${rateMode === 'multiple' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
              >
                {t('projectDetails.byPosition')}
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
                placeholder={t('projectDetails.ratePerManHour')}
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
                      placeholder={t('projectDetails.positionNamePlaceholder')}
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
                      placeholder={t('projectDetails.rmPerHour')}
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
                  {t('projectDetails.addPosition')}
                </button>
              </div>
            )}
            {details?.lastGuardRateChange && (
              <p className="text-[11px] text-slate-400 mt-2">
                {t('projectDetails.rateLastChanged', {
                  from: details.lastGuardRateChange.fromRate.toFixed(2),
                  to: details.lastGuardRateChange.toRate.toFixed(2),
                  date: formatDateTime(details.lastGuardRateChange.changedAt),
                  name: details.lastGuardRateChange.changedByName,
                })}
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
                  {t(delta > 0 ? 'projectDetails.rateChangeAdds' : 'projectDetails.rateChangeRemoves', {
                    amount: Math.abs(delta).toFixed(2),
                    hours: STANDARD_MONTHLY_HOURS_PER_GUARD,
                    guardsText: t('projectDetails.guardsUnit', { count: site.activeGuardCount }),
                    monthsText: t('projectDetails.monthsUnit', { count: months }),
                  })}
                </p>
              );
            })()}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-2">
              {t('projectDetails.additionalEquipment')} <span className="text-slate-400 font-normal">({t('common.optional')})</span>
            </p>
            {items.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {items.map((eq) => (
                  <div key={eq.id} className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-slate-700 font-medium">{eq.item}</span>{' '}
                        <span className="text-slate-500">
                          {t('projectDetails.equipmentRowDetail', { rate: eq.monthlyRate.toFixed(2), qty: eq.quantity, date: formatDate(eq.startDate) })}
                        </span>
                        {eq.stoppedDate && <span className="text-amber-600">{t('projectDetails.stoppedOn', { date: formatDate(eq.stoppedDate) })}</span>}
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
                          {t('projectDetails.stop')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveEquipment(eq.id, eq.item)}
                        disabled={eqBusy !== null}
                        className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-60 shrink-0"
                      >
                        {eqBusy === eq.id ? t('projectDetails.removingEllipsis') : t('projectDetails.remove')}
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
                          {eqBusy === `stop-${eq.id}` ? t('projectDetails.stoppingEllipsis') : t('projectDetails.confirmStop')}
                        </button>
                        <button type="button" onClick={() => setStoppingItemId(null)} className="text-xs text-slate-400 hover:text-slate-600">
                          {t('projectDetails.cancel')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <div className="flex gap-2">
                <input value={eqItem} onChange={(e) => setEqItem(e.target.value)} placeholder={t('projectDetails.equipmentNamePlaceholder')} className="input flex-1" />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={eqRate}
                  onChange={(e) => setEqRate(e.target.value)}
                  placeholder={t('projectDetails.rmPerMonth')}
                  className="input w-24"
                />
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={eqQty}
                  onChange={(e) => setEqQty(e.target.value)}
                  placeholder={t('projectDetails.qty')}
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
                  {eqBusy === 'add' ? t('projectDetails.addingEllipsis') : t('projectDetails.addEquipment')}
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
              {saving ? t('projectDetails.savingEllipsis') : t('linkedSiteCard.saveSiteDetails')}
            </button>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-400 max-w-[60%]">
              {site.archived ? t('linkedSiteCard.archivedHint') : t('linkedSiteCard.archivingHint')}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={lifecycleBusy !== null}
                onClick={handleToggleArchive}
                className="text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 rounded px-2.5 py-1 border border-slate-200"
              >
                {lifecycleBusy === 'archive' ? t('projectDetails.savingEllipsis') : site.archived ? t('linkedSiteCard.unarchiveSite') : t('linkedSiteCard.archiveSite')}
              </button>
              <button
                type="button"
                disabled={lifecycleBusy !== null}
                onClick={handleRemove}
                className="text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60 rounded px-2.5 py-1 border border-rose-200"
              >
                {lifecycleBusy === 'remove' ? t('projectDetails.removingEllipsis') : t('linkedSiteCard.removeFromProject')}
              </button>
            </div>
          </div>
          {lifecycleError && <p className="text-xs text-rose-600">{lifecycleError}</p>}
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
