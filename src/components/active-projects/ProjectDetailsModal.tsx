import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Role, Tender } from '../../types';
import {
  addTenderEquipment,
  addTenderSiteEquipment,
  applyGuardRateChange,
  applyTenderSiteGuardRateChange,
  createTenderSite,
  effectiveGuardRate,
  estimatedMonthlySiteValue,
  getTenderSiteDetails,
  removeTenderEquipmentItem,
  resetTenderSiteMode,
  saveTenderSiteLocationDetails,
  setTenderSiteMode,
  STANDARD_MONTHLY_HOURS_PER_GUARD,
  stopTenderEquipmentItem,
  updateActiveProjectDetails,
  wholeMonthsInclusive,
} from '../../services/tenders';
import { formatDate, formatDateTime } from '../../utils/format';
import {
  deleteTenderDocument,
  openTenderDocument,
  uploadTenderDocument,
  type TenderDocumentInfo,
} from '../../services/tenderDocuments';
import { useTenderSites } from '../../hooks/useTenderSites';
import LinkedSiteDetailsCard from './LinkedSiteDetailsCard';

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
  /** Needed for the Additional Equipment section below and Guard Rate changes — addTenderEquipment()/
   *  removeTenderEquipmentItem()/stopTenderEquipmentItem()/applyGuardRateChange() log a history
   *  entry attributed to whoever's making the change, same as RenewContractModal's own actor prop. */
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
  const [siteName, setSiteName] = useState('');
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
  // Guards the one-time site-name prefill below from re-firing on every live update from
  // useTenderSites' onSnapshot subscription — reset to null whenever the modal (re)opens (see the
  // [open, tender] effect below) so a genuine reopen still re-syncs from the current primary site.
  const siteNameInitKeyRef = useRef<string | null>(null);

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
  const [eqBusy, setEqBusy] = useState<string | null>(null); // 'add', 'stop-<id>', an item id being removed, or null
  const [eqError, setEqError] = useState<string | null>(null);
  // Which equipment item currently has its "Stop" mini-form open (see stopTenderEquipmentItem()
  // in services/tenders.ts) — at most one at a time — and the date drafted into it.
  const [stoppingItemId, setStoppingItemId] = useState<string | null>(null);
  const [stopDateDraft, setStopDateDraft] = useState('');

  // Linked Sites (see useTenderSites' own doc comment) — a project with more than one worksite
  // under the same contract. Kept last since it's purely additive UI; every field above this
  // still refers only to the project's first/original site.
  const { sites: linkedSites, loading: linkedSitesLoading } = useTenderSites(tender?.id ?? null);
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [addSiteName, setAddSiteName] = useState('');
  // Same required fields as the project's first/original site's own Location/Contact section
  // above (see that section's own required-ness) — a linked site can't be added half-empty; its
  // Location/Contact details are captured up front, in the same action that creates it, rather
  // than left for someone to remember to fill in later on a bare, unlabeled card. Guard Rate and
  // Additional Equipment stay optional here too, matching the first site's own form — those are
  // filled in afterwards, from the site's own card, once it exists.
  const [addSiteLocation, setAddSiteLocation] = useState('');
  const [addSiteState, setAddSiteState] = useState('');
  const [addSiteCity, setAddSiteCity] = useState('');
  const [addSitePostcode, setAddSitePostcode] = useState('');
  const [addSiteContact, setAddSiteContact] = useState('');
  // Guard Rate and Additional Equipment, filled in as part of the SAME "+ Add Site" form rather
  // than only afterwards from the site's own card — both stay optional (same as the project's
  // first/original site's own form), but staff who already know a site's rate/equipment up
  // front shouldn't have to save, find the new card, expand it, and re-enter them there.
  const [addSiteRateMode, setAddSiteRateMode] = useState<'same' | 'multiple'>('same');
  const [addSiteFlatRate, setAddSiteFlatRate] = useState('');
  const [addSitePositions, setAddSitePositions] = useState<{ name: string; rate: string }[]>([]);
  // Equipment items are queued locally (no siteId exists to save them against yet) and only
  // actually written — one addTenderSiteEquipment() call per queued row — once "Add Site" below
  // creates the real site.
  const [addSiteEqDraftItem, setAddSiteEqDraftItem] = useState('');
  const [addSiteEqDraftRate, setAddSiteEqDraftRate] = useState('');
  const [addSiteEqDraftQty, setAddSiteEqDraftQty] = useState('');
  const [addSiteEqDraftStart, setAddSiteEqDraftStart] = useState('');
  const [addSiteEqDraftError, setAddSiteEqDraftError] = useState<string | null>(null);
  const [addSiteEquipmentQueue, setAddSiteEquipmentQueue] = useState<
    { queueId: string; item: string; monthlyRate: string; quantity: string; startDate: string }[]
  >([]);
  const [addSiteBusy, setAddSiteBusy] = useState(false);
  const [addSiteError, setAddSiteError] = useState<string | null>(null);

  // "Does this project have a single site or multiple sites?" — asked once, up front, before
  // the rest of Project Details is even shown (see the chooser rendered in place of the form
  // below). See Tender.siteMode's doc comment in types.ts for why a project with more than one
  // linked site already (from before this field existed) skips the question entirely.
  const [siteModeBusy, setSiteModeBusy] = useState<'single' | 'multiple' | null>(null);
  const [siteModeError, setSiteModeError] = useState<string | null>(null);

  const resetAddSiteForm = () => {
    setAddSiteOpen(false);
    setAddSiteName('');
    setAddSiteLocation('');
    setAddSiteState('');
    setAddSiteCity('');
    setAddSitePostcode('');
    setAddSiteContact('');
    setAddSiteRateMode('same');
    setAddSiteFlatRate('');
    setAddSitePositions([]);
    setAddSiteEqDraftItem('');
    setAddSiteEqDraftRate('');
    setAddSiteEqDraftQty('');
    setAddSiteEqDraftStart('');
    setAddSiteEqDraftError(null);
    setAddSiteEquipmentQueue([]);
    setAddSiteError(null);
  };

  const queueAddSiteEquipment = () => {
    setAddSiteEqDraftError(null);
    const name = addSiteEqDraftItem.trim();
    const rate = Number(addSiteEqDraftRate);
    const qty = Number(addSiteEqDraftQty);
    if (!name) { setAddSiteEqDraftError('Enter the equipment name.'); return; }
    if (!Number.isFinite(rate) || rate < 0) { setAddSiteEqDraftError('Enter a valid monthly rate.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { setAddSiteEqDraftError('Enter a valid quantity.'); return; }
    if (!addSiteEqDraftStart) { setAddSiteEqDraftError('Pick a start date.'); return; }
    setAddSiteEquipmentQueue((q) => [
      ...q,
      { queueId: crypto.randomUUID(), item: name, monthlyRate: addSiteEqDraftRate, quantity: addSiteEqDraftQty, startDate: addSiteEqDraftStart },
    ]);
    setAddSiteEqDraftItem('');
    setAddSiteEqDraftRate('');
    setAddSiteEqDraftQty('');
  };

  const addSiteReady =
    addSiteName.trim() !== '' &&
    addSiteLocation.trim() !== '' &&
    addSiteState.trim() !== '' &&
    addSiteCity.trim() !== '' &&
    addSitePostcode.trim() !== '' &&
    addSiteContact.trim() !== '';

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
    siteNameInitKeyRef.current = null;
    setEqItem('');
    setEqRate('');
    setEqQty('');
    const todayStr = new Date().toISOString().slice(0, 10);
    setEqStartDate(tender.contractStart && tender.contractStart > todayStr ? tender.contractStart : todayStr);
    setEqError(null);
    setStoppingItemId(null);
    setStopDateDraft(todayStr);
    setRateMode(tender.guardRateMode === 'multiple' ? 'multiple' : 'same');
    setFlatRate(tender.guardRate != null ? String(tender.guardRate) : '');
    setPositions(
      tender.guardRatePositions && tender.guardRatePositions.length
        ? tender.guardRatePositions.map((p) => ({ name: p.name, rate: String(p.rate) }))
        : []
    );
    setError(null);
  }, [open, tender]);

  // Prefills Site Name from the current primary Duty Roster site's own name (see
  // useTenderSites' doc comment) — separate from the effect above because linkedSites loads
  // asynchronously and may not be ready yet when this modal first opens. Runs once per modal
  // open (guarded by siteNameInitKeyRef), so it doesn't clobber what the user is actively typing
  // when useTenderSites' live subscription pushes a later update.
  useEffect(() => {
    if (!open || !tender) return;
    if (linkedSitesLoading) return;
    if (siteNameInitKeyRef.current === tender.id) return;
    const primary = linkedSites.find((s) => s.isPrimary);
    setSiteName(primary?.name || '');
    siteNameInitKeyRef.current = tender.id;
  }, [open, tender, linkedSites, linkedSitesLoading]);

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

  // Opens the inline "Stop" mini-form for one equipment item (see stopTenderEquipmentItem()'s
  // doc comment in services/tenders.ts for Stop vs Remove) — defaults the date to today, clamped
  // to the item's own startDate through the contract's end.
  const handleOpenStop = (itemId: string, itemStartDate: string) => {
    const activeTender = workingTender || tender;
    if (!activeTender) return;
    setEqError(null);
    const todayStr = new Date().toISOString().slice(0, 10);
    const floor = itemStartDate > todayStr ? itemStartDate : todayStr;
    setStopDateDraft(activeTender.contractEnd && floor > activeTender.contractEnd ? activeTender.contractEnd : floor);
    setStoppingItemId(itemId);
  };

  const handleConfirmStop = async (itemId: string) => {
    const activeTender = workingTender || tender;
    if (!activeTender) return;
    if (!stopDateDraft) { setEqError('Pick a stop date.'); return; }
    setEqError(null);
    setEqBusy(`stop-${itemId}`);
    try {
      await stopTenderEquipmentItem(activeTender, itemId, stopDateDraft, actor);
      await refreshWorkingTender();
      setStoppingItemId(null);
    } catch (err) {
      setEqError(err instanceof Error ? err.message : 'Could not stop this equipment item.');
    } finally {
      setEqBusy(null);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Every field on this form is required before it can be saved, except Tender Document No.
    // (often not issued yet) and the Guard Rate section below.
    if (!siteName.trim()) { setError('Site Name is required.'); return; }
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

    const baseTender = workingTender || tender;
    setSaving(true);
    try {
      await updateActiveProjectDetails(tender.id, tender.clientName, siteName.trim(), {
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
      });
      // Guard Rate is written separately from the rest of this form (see applyGuardRateChange()
      // in services/tenders.ts) because, unlike everything else above, a changed rate can also
      // bump this project's tracked contract value — routed through `baseTender` rather than the
      // (possibly stale) `tender` prop so it doesn't clobber a tenderValue an equipment add/stop/
      // remove already wrote earlier in this same modal session.
      if (Object.keys(rateFields).length > 0) {
        await applyGuardRateChange(
          baseTender,
          {
            guardRateMode: rateFields.guardRateMode!,
            guardRate: rateFields.guardRate,
            guardRatePositions: rateFields.guardRatePositions,
            guardsDeployed: guards ?? liveGuardCount ?? baseTender.guardsDeployed ?? 0,
          },
          actor
        );
      }
      onClose();
    } catch (err) {
      console.error(err);
      setError('Could not save these details. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const activeTenderNow = workingTender || tender;
  // See Tender.siteMode's doc comment in types.ts — a project that already has more than one
  // linked site (from before this field existed) is treated as 'multiple' without ever asking.
  const needsSiteModeChoice = !linkedSitesLoading && !activeTenderNow.siteMode && linkedSites.length <= 1;
  const effectiveSiteMode = activeTenderNow.siteMode || 'multiple';

  const handleChooseSiteMode = async (mode: 'single' | 'multiple') => {
    setSiteModeBusy(mode);
    setSiteModeError(null);
    try {
      await setTenderSiteMode(activeTenderNow.id, mode);
      await refreshWorkingTender();
    } catch (err) {
      setSiteModeError(err instanceof Error ? err.message : 'Failed to save this choice.');
    } finally {
      setSiteModeBusy(null);
    }
  };

  // Estimated monthly value by site — a reporting summary only (see estimatedMonthlySiteValue()'s
  // own doc comment in services/tenders.ts); never written anywhere, and the project's actual
  // tenderValue stays combined regardless. The primary site (linkedSites[0]) reads its guard
  // rate/equipment straight off the tender's own top-level fields, same as the rest of this
  // form; every other site reads its own siteDetails doc via useTenderSites().
  const valueBreakdown = linkedSites.map((site) => {
    const guardsDeployed = site.isPrimary ? liveGuardCount ?? activeTenderNow.guardsDeployed ?? 0 : site.activeGuardCount;
    const guardRateMode = site.isPrimary ? activeTenderNow.guardRateMode : site.details?.guardRateMode;
    const guardRate = site.isPrimary ? activeTenderNow.guardRate : site.details?.guardRate;
    const guardRatePositions = site.isPrimary ? activeTenderNow.guardRatePositions : site.details?.guardRatePositions;
    const equipment = site.isPrimary ? activeTenderNow.additionalEquipment : site.details?.additionalEquipment;
    return {
      key: site.id,
      label: site.name,
      ...estimatedMonthlySiteValue(guardRateMode, guardRate, guardRatePositions, guardsDeployed, equipment),
    };
  });
  const combinedMonthlyValue = valueBreakdown.reduce((sum, row) => sum + row.total, 0);

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

        {linkedSitesLoading ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">Loading…</div>
        ) : needsSiteModeChoice ? (
          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-slate-600">
              Does this project run out of a single worksite, or does it have more than one
              site/roster under this same contract?
            </p>
            {siteModeError && <p className="text-xs text-rose-600">{siteModeError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={siteModeBusy !== null}
                onClick={() => handleChooseSiteMode('single')}
                className="px-3 py-3 text-sm font-medium rounded-lg border bg-white text-slate-700 border-slate-200 hover:bg-slate-50 disabled:opacity-60"
              >
                {siteModeBusy === 'single' ? 'Saving…' : 'Single Site'}
              </button>
              <button
                type="button"
                disabled={siteModeBusy !== null}
                onClick={() => handleChooseSiteMode('multiple')}
                className="px-3 py-3 text-sm font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-60"
              >
                {siteModeBusy === 'multiple' ? 'Saving…' : 'Multiple Sites'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              This is asked once — Multiple Sites adds a "+ Add Site" option below for linking
              more than one Duty Roster site to this same contract; Single Site keeps this form
              to just the one site's details.
            </p>
          </div>
        ) : (
        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          {activeTenderNow.siteMode && (
            <div className="flex items-center justify-between -mb-1">
              <span className="text-[11px] text-slate-400">
                {activeTenderNow.siteMode === 'single' ? 'Single Site' : 'Multiple Sites'}
              </span>
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  try {
                    await resetTenderSiteMode(activeTenderNow.id);
                    await refreshWorkingTender();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to reset this choice.');
                  }
                }}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
              >
                Change
              </button>
            </div>
          )}

          <Field label="Site Name">
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              className="input"
              placeholder="e.g. Menara ABC"
            />
          </Field>

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

            {tender.lastGuardRateChange && (
              <p className="text-[11px] text-slate-400 mt-2">
                Rate last changed from RM {tender.lastGuardRateChange.fromRate.toFixed(2)} to RM{' '}
                {tender.lastGuardRateChange.toRate.toFixed(2)} on {formatDateTime(tender.lastGuardRateChange.changedAt)} by{' '}
                {tender.lastGuardRateChange.changedByName}.
              </p>
            )}

            {(() => {
              // Live preview of applyGuardRateChange()'s estimate — only shown once this
              // project already has a rate on file (a first-time rate isn't an "increase") and
              // the form's current inputs actually work out to a different effective rate.
              if (tender.guardRateMode == null) return null;
              const oldEffective = effectiveGuardRate(tender.guardRateMode, tender.guardRate, tender.guardRatePositions);
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
              const guardsForPreview = liveGuardCount ?? (Number(guardsDeployed) || 0);
              const monthsForPreview = wholeMonthsInclusive(new Date().toISOString().slice(0, 10), tender.contractEnd);
              const delta = (newEffective - oldEffective) * STANDARD_MONTHLY_HOURS_PER_GUARD * guardsForPreview * monthsForPreview;
              if (delta === 0) return null;
              return (
                <p className="text-[11px] text-slate-400 mt-2">
                  {delta > 0 ? 'Adds an estimated' : 'Removes an estimated'} RM {Math.abs(delta).toFixed(2)} from
                  this project's tracked contract value (assumes {STANDARD_MONTHLY_HOURS_PER_GUARD} hrs/guard/month
                  × {guardsForPreview} guard{guardsForPreview === 1 ? '' : 's'} × {monthsForPreview} month
                  {monthsForPreview === 1 ? '' : 's'} remaining).
                </p>
              );
            })()}
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
                        <div key={eq.id} className="text-sm bg-slate-50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 min-w-0">
                              <span className="text-slate-700 font-medium">{eq.item}</span>{' '}
                              <span className="text-slate-500">
                                RM {eq.monthlyRate.toFixed(2)} × {eq.quantity} / month, from {formatDate(eq.startDate)}
                              </span>
                              {eq.stoppedDate && (
                                <span className="text-amber-600"> · stopped {formatDate(eq.stoppedDate)}</span>
                              )}
                            </div>
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              +RM {eq.valueContribution.toFixed(2)}
                              {eq.stopValueReversal ? ` (−RM ${eq.stopValueReversal.toFixed(2)})` : ''}
                            </span>
                            {!eq.stoppedDate && (
                              <button
                                type="button"
                                onClick={() => handleOpenStop(eq.id, eq.startDate)}
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
                                max={activeTender.contractEnd || undefined}
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
                              <button
                                type="button"
                                onClick={() => setStoppingItemId(null)}
                                className="text-xs text-slate-400 hover:text-slate-600"
                              >
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

          {effectiveSiteMode === 'multiple' && (
          <div className="pt-2 border-t border-slate-100">
            <p className="block text-xs font-medium text-slate-500 mb-2">
              Linked Sites{' '}
              <span className="text-slate-400 font-normal">
                (for a client with more than one worksite/roster under this same contract; each
                linked site gets its own Location, Guard Rate and Additional Equipment below,
                while the contract value above stays combined)
              </span>
            </p>

            {linkedSites.length > 1 && (
              <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2">
                <p className="text-[11px] font-medium text-slate-500">
                  Estimated monthly value by site{' '}
                  <span className="text-slate-400 font-normal">
                    (guard rate + active equipment, right now — a snapshot for reporting, not a
                    split of the combined contract value above)
                  </span>
                </p>
                {valueBreakdown.map((row) => (
                  <div key={row.key} className="text-xs">
                    <div className="flex items-center justify-between text-slate-700">
                      <span className="truncate font-medium">{row.label}</span>
                      <span className="font-medium shrink-0 ml-2">RM {row.total.toFixed(2)}/mo</span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      RM {row.guardRateValue.toFixed(2)} guard rate + RM {row.equipmentValue.toFixed(2)} equipment
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 pt-2 border-t border-slate-200">
                  <span>Combined</span>
                  <span>RM {combinedMonthlyValue.toFixed(2)}/mo</span>
                </div>
              </div>
            )}

            {linkedSites.length > 1 && (
              <div className="space-y-2 mb-3">
                {linkedSites.slice(1).map((site) => (
                  <LinkedSiteDetailsCard key={site.id} tender={workingTender || tender} site={site} actor={actor} />
                ))}
              </div>
            )}

            {linkedSites.length === 0 ? (
              <p className="text-xs text-slate-400">
                This project doesn't have a Duty Roster site yet — open "Duty Roster" from Active
                Projects first to create its first site before linking a second one here.
              </p>
            ) : addSiteOpen ? (
              <div className="border border-slate-200 rounded-lg p-3 space-y-3">
                <Field label="Site Name">
                  <input
                    value={addSiteName}
                    onChange={(e) => setAddSiteName(e.target.value)}
                    placeholder="e.g. Menara KL"
                    className="input"
                    disabled={addSiteBusy}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Location">
                    <input
                      value={addSiteLocation}
                      onChange={(e) => setAddSiteLocation(e.target.value)}
                      placeholder="Worksite address"
                      className="input"
                      disabled={addSiteBusy}
                    />
                  </Field>
                  <Field label="Contact Person">
                    <input
                      value={addSiteContact}
                      onChange={(e) => setAddSiteContact(e.target.value)}
                      className="input"
                      disabled={addSiteBusy}
                    />
                  </Field>
                  <Field label="State">
                    <input
                      value={addSiteState}
                      onChange={(e) => setAddSiteState(e.target.value)}
                      className="input"
                      disabled={addSiteBusy}
                    />
                  </Field>
                  <Field label="City">
                    <input
                      value={addSiteCity}
                      onChange={(e) => setAddSiteCity(e.target.value)}
                      className="input"
                      disabled={addSiteBusy}
                    />
                  </Field>
                  <Field label="Postcode">
                    <input
                      value={addSitePostcode}
                      onChange={(e) => setAddSitePostcode(e.target.value)}
                      className="input"
                      disabled={addSiteBusy}
                    />
                  </Field>
                </div>
                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-2">
                    Guard Rate <span className="text-slate-400 font-normal">(optional)</span>
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      disabled={addSiteBusy}
                      onClick={() => setAddSiteRateMode('same')}
                      className={`px-2 py-1 text-xs rounded-lg border ${addSiteRateMode === 'same' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                      Same rate for all
                    </button>
                    <button
                      type="button"
                      disabled={addSiteBusy}
                      onClick={() => setAddSiteRateMode('multiple')}
                      className={`px-2 py-1 text-xs rounded-lg border ${addSiteRateMode === 'multiple' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                      By position
                    </button>
                  </div>
                  {addSiteRateMode === 'same' ? (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={addSiteFlatRate}
                      onChange={(e) => setAddSiteFlatRate(e.target.value)}
                      className="input"
                      placeholder="RM per man-hour"
                      disabled={addSiteBusy}
                    />
                  ) : (
                    <div className="space-y-2">
                      {addSitePositions.map((pos, idx) => (
                        <div key={idx} className="flex gap-2 items-start">
                          <input
                            value={pos.name}
                            onChange={(e) => {
                              const next = [...addSitePositions];
                              next[idx] = { ...next[idx], name: e.target.value };
                              setAddSitePositions(next);
                            }}
                            className="input flex-1"
                            placeholder="e.g. Leader"
                            disabled={addSiteBusy}
                          />
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={pos.rate}
                            onChange={(e) => {
                              const next = [...addSitePositions];
                              next[idx] = { ...next[idx], rate: e.target.value };
                              setAddSitePositions(next);
                            }}
                            className="input w-24"
                            placeholder="RM/hr"
                            disabled={addSiteBusy}
                          />
                          <button
                            type="button"
                            onClick={() => setAddSitePositions(addSitePositions.filter((_, i) => i !== idx))}
                            disabled={addSiteBusy}
                            className="text-slate-400 hover:text-rose-600 text-lg leading-none px-1 pt-1.5"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        disabled={addSiteBusy}
                        onClick={() => setAddSitePositions([...addSitePositions, { name: '', rate: '' }])}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        + Add position
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-2">
                    Additional Equipment <span className="text-slate-400 font-normal">(optional)</span>
                  </p>
                  {addSiteEquipmentQueue.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {addSiteEquipmentQueue.map((eq) => (
                        <div key={eq.queueId} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-slate-700 font-medium">{eq.item}</span>{' '}
                            <span className="text-slate-500">
                              RM {eq.monthlyRate} × {eq.quantity} / month, from {eq.startDate}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={addSiteBusy}
                            onClick={() => setAddSiteEquipmentQueue((q) => q.filter((x) => x.queueId !== eq.queueId))}
                            className="text-xs font-medium text-rose-500 hover:text-rose-600 disabled:opacity-60 shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={addSiteEqDraftItem}
                        onChange={(e) => setAddSiteEqDraftItem(e.target.value)}
                        placeholder="e.g. E-bike"
                        className="input flex-1"
                        disabled={addSiteBusy}
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={addSiteEqDraftRate}
                        onChange={(e) => setAddSiteEqDraftRate(e.target.value)}
                        placeholder="RM/month"
                        className="input w-24"
                        disabled={addSiteBusy}
                      />
                      <input
                        type="number"
                        min={1}
                        step="1"
                        value={addSiteEqDraftQty}
                        onChange={(e) => setAddSiteEqDraftQty(e.target.value)}
                        placeholder="Qty"
                        className="input w-16"
                        disabled={addSiteBusy}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={addSiteEqDraftStart}
                        min={(workingTender || tender).contractStart || undefined}
                        max={(workingTender || tender).contractEnd || undefined}
                        onChange={(e) => setAddSiteEqDraftStart(e.target.value)}
                        className="input"
                        disabled={addSiteBusy}
                      />
                      <button
                        type="button"
                        onClick={queueAddSiteEquipment}
                        disabled={addSiteBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-60 whitespace-nowrap"
                      >
                        + Add equipment
                      </button>
                    </div>
                    {addSiteEqDraftError && <p className="text-[11px] text-rose-600">{addSiteEqDraftError}</p>}
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  Site Name, Location, Contact Person, State, City and Postcode are required to
                  add the site. Guard Rate and Additional Equipment are optional here and can
                  also be changed later from the site's own card — set up its guards and roster
                  from the Duty Roster tab whenever you're ready.
                </p>
                {addSiteError && <p className="text-xs text-rose-600">{addSiteError}</p>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!addSiteReady || addSiteBusy}
                    onClick={async () => {
                      let activeTender = workingTender || tender;
                      const branch = activeTender.activeBranch || activeTender.department || null;
                      const siteName = addSiteName.trim();
                      setAddSiteBusy(true);
                      setAddSiteError(null);
                      try {
                        const siteId = await createTenderSite(activeTender, siteName, actor);
                        await saveTenderSiteLocationDetails(activeTender.id, siteId, siteName, branch, activeTender.clientName, {
                          location: addSiteLocation.trim(),
                          state: addSiteState.trim(),
                          city: addSiteCity.trim(),
                          postcode: addSitePostcode.trim(),
                          contactPerson: addSiteContact.trim(),
                        });

                        const wantsRate =
                          addSiteRateMode === 'same'
                            ? addSiteFlatRate.trim() !== ''
                            : addSitePositions.some((p) => p.name.trim() !== '' && p.rate.trim() !== '');
                        if (wantsRate) {
                          await applyTenderSiteGuardRateChange(
                            activeTender,
                            siteId,
                            siteName,
                            branch,
                            null,
                            {
                              guardRateMode: addSiteRateMode,
                              guardRate: addSiteRateMode === 'same' ? Number(addSiteFlatRate) || 0 : undefined,
                              guardRatePositions:
                                addSiteRateMode === 'multiple'
                                  ? addSitePositions
                                      .filter((p) => p.name.trim() !== '' && p.rate.trim() !== '')
                                      .map((p) => ({ name: p.name.trim(), rate: Number(p.rate) || 0 }))
                                  : undefined,
                              guardsDeployed: 0,
                            },
                            actor
                          );
                        }

                        // Equipment items are queued locally, so apply them one at a time here,
                        // re-reading the tender and this site's own siteDetails doc between each
                        // — same reasoning as refreshWorkingTender() above: each item's value
                        // bump has to compute against the total the PREVIOUS one just wrote, not
                        // a stale snapshot from before this form was even opened.
                        for (const eq of addSiteEquipmentQueue) {
                          const tenderSnap = await getDoc(doc(db, 'tenders', activeTender.id));
                          if (tenderSnap.exists()) activeTender = { id: tenderSnap.id, ...(tenderSnap.data() as Omit<Tender, 'id'>) };
                          const currentSiteDetails = await getTenderSiteDetails(activeTender.id, siteId);
                          await addTenderSiteEquipment(
                            activeTender,
                            siteId,
                            siteName,
                            branch,
                            currentSiteDetails,
                            {
                              item: eq.item,
                              monthlyRate: Number(eq.monthlyRate) || 0,
                              quantity: Number(eq.quantity) || 0,
                              startDate: eq.startDate,
                            },
                            actor
                          );
                        }

                        await refreshWorkingTender();
                        resetAddSiteForm();
                      } catch (err) {
                        setAddSiteError(err instanceof Error ? err.message : 'Failed to add site.');
                      } finally {
                        setAddSiteBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-60 whitespace-nowrap"
                  >
                    {addSiteBusy ? 'Adding…' : 'Add Site'}
                  </button>
                  <button
                    type="button"
                    onClick={resetAddSiteForm}
                    disabled={addSiteBusy}
                    className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddSiteOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border bg-white text-blue-700 border-blue-200 hover:bg-blue-50 whitespace-nowrap"
              >
                + Add Site
              </button>
            )}
          </div>
          )}

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
        )}
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
