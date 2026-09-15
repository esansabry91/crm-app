import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { releaseGuardsFromSite } from './guards';
import { shouldStampTestData } from './settings';
import type { Role, Stage, Tender, TenderEquipmentItem, TenderSiteDetails } from '../types';
import { isAdminRole } from '../types';

/** Actor performing an action — `role` is optional only for call-site back-compat; every real
 *  caller passes it. */
type Actor = { uid: string; name: string; role?: Role };

/**
 * What `activeBranch` should default to the moment a tender becomes Won. Won by an admin gets
 * left unassigned (null) — an admin isn't tied to one branch, so there's no branch to guess, and
 * the Active Projects list should force an explicit pick rather than silently defaulting to
 * whatever `department` happens to hold. Same for a tender submitted under "HQ" itself, since HQ
 * doesn't run active projects (see the doc comment on Tender.activeBranch). Otherwise, default to
 * the submitting branch (`department`) as a convenience.
 */
function defaultActiveBranchOnWin(department: string, actorRole: Role | undefined): string | null {
  if (isAdminRole(actorRole)) return null;
  if (department === 'HQ') return null;
  return department;
}

export interface NewTenderInput {
  clientName: string;
  brandId: string;
  brandName: string;
  department: string;
  contractStart: string;
  contractEnd: string;
  tenderValue: number;
  stage: Stage;
  ownerUid: string;
  ownerName: string;
  notes?: string;
  /** See Tender.category's doc comment in types.ts — compulsory, validated by the form before this is ever called. */
  category: 'Government' | 'Private';
  /** See Tender.currentContractEndDate's doc comment in types.ts. Always optional. */
  currentContractEndDate?: string;
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Won or Lost. Used to backfill history. */
  closedDate?: string;
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Submitted or later. See Tender.submittedDate. */
  submittedDate?: string;
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Submitted or later. See Tender.submissionExpiryDate. */
  submissionExpiryDate?: string;
}

async function addHistoryEntry(
  tenderId: string,
  data: {
    type: 'created' | 'stage_change' | 'value_change' | 'updated' | 'deleted';
    stage: Stage;
    value: number;
    changedByUid: string;
    changedByName: string;
    ownerUid: string;
    fromStage?: Stage;
    /** See TenderHistoryEntry.valueChangeReason's doc comment in types.ts. */
    valueChangeReason?: 'renewal' | 'equipment_increase' | 'equipment_decrease' | 'guard_rate';
  },
  timestamp: number = Date.now()
) {
  await addDoc(collection(db, 'tenders', tenderId, 'history'), {
    tenderId,
    timestamp,
    createdAt: serverTimestamp(),
    ...data,
  });
}

/**
 * yyyy-mm-dd -> epoch millis for a history entry's timestamp. Returns the exact current instant
 * when `closedDate` IS today — so multiple backdated-but-actually-live actions taken today on the
 * same tender (e.g. declare equipment, then stop it, then change Guard Rate, all in one sitting)
 * get distinct, correctly-ordered timestamps instead of colliding on an identical value. Falls
 * back to local noon on that date for a genuinely past (or future) date, where there's no real
 * "time of day" to recover anyway (also avoids timezone edge cases shifting it to the wrong day).
 * See activeProjectValueBridge()'s history-replay sort in utils/analytics.ts, which additionally
 * breaks any remaining tie (two genuinely-backdated entries landing on the same past date) using
 * each entry's own `createdAt` — this only handles the much more common same-day case.
 */
function closedDateToMillis(closedDate: string): number {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (closedDate === todayStr) return Date.now();
  return new Date(`${closedDate}T12:00:00`).getTime();
}

export async function createTender(
  input: NewTenderInput,
  actor: Actor
): Promise<string> {
  const now = Date.now();
  const isClosed = input.stage === 'Won' || input.stage === 'Lost';
  const historyTimestamp = isClosed && input.closedDate ? closedDateToMillis(input.closedDate) : now;
  // See Tender.isTestData's doc comment in types.ts — stamped once, at creation, from whatever
  // Testing Mode was set to at that moment, OR'd with whether the creating account is itself a
  // 'developer' account (see shouldStampTestData()'s doc comment in services/settings.ts).
  const isTestData = await shouldStampTestData(actor.role);

  // Firestore's addDoc() rejects fields explicitly set to `undefined` — closedDate/submittedDate
  // are optional and undefined for most tenders, so they must be omitted entirely rather than
  // spread in as `closedDate: undefined`.
  const { closedDate, submittedDate, submissionExpiryDate, currentContractEndDate, ...rest } = input;
  const docRef = await addDoc(collection(db, 'tenders'), {
    ...rest,
    ...(closedDate ? { closedDate } : {}),
    ...(submittedDate ? { submittedDate } : {}),
    ...(submissionExpiryDate ? { submissionExpiryDate } : {}),
    ...(currentContractEndDate ? { currentContractEndDate } : {}),
    // A tender can be created directly in the Won stage (not just moved there later) — give it
    // the same activeBranch default moveTenderStage would, so it doesn't rely on the opportunistic
    // backfill (which has no idea who created it) to fill this in afterwards.
    ...(input.stage === 'Won' ? { activeBranch: defaultActiveBranchOnWin(input.department, actor.role) } : {}),
    isTestData,
    createdAt: now,
    updatedAt: now,
  });
  await addHistoryEntry(
    docRef.id,
    {
      type: 'created',
      stage: input.stage,
      value: input.tenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: input.ownerUid,
    },
    historyTimestamp
  );
  return docRef.id;
}

/** Update the editable fields of a tender (does not touch stage). */
export async function updateTender(
  tenderId: string,
  patch: Partial<NewTenderInput>,
  actor: Actor,
  current: Tender
) {
  await updateDoc(doc(db, 'tenders', tenderId), {
    ...patch,
    updatedAt: Date.now(),
  });
  const valueChanged = patch.tenderValue !== undefined && patch.tenderValue !== current.tenderValue;
  if (valueChanged) {
    await addHistoryEntry(tenderId, {
      type: 'value_change',
      stage: current.stage,
      value: patch.tenderValue!,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: patch.ownerUid ?? current.ownerUid,
    });
  }
}

/**
 * Move a tender to a new stage (kanban drag, or explicit stage change from the form).
 * Pass `closedDate` (yyyy-mm-dd) when moving to Won/Lost with a known historical date — the
 * trend chart will then reflect that real date instead of "today".
 * Pass `submittedDate` (yyyy-mm-dd) when moving to Submitted for the FIRST time — the caller
 * (see the drag-to-Submitted flow in PipelinePage.tsx, and TenderFormModal's own validation) is
 * responsible for actually collecting it; this only ever writes it when the tender doesn't
 * already have one, so a stray call can never silently overwrite an already-set value — and
 * firestore.rules enforces the same thing independently of this client-side check.
 * `submissionExpiryDate` (yyyy-mm-dd) rides along in that same first-Submitted write when the
 * caller collected one (see SubmissionDateModal.tsx) — unlike submittedDate it isn't locked
 * afterwards, so a later correction goes through setSubmissionExpiryDate() below instead of here.
 */
export async function moveTenderStage(
  tender: Tender,
  newStage: Stage,
  actor: Actor,
  closedDate?: string,
  submittedDate?: string,
  submissionExpiryDate?: string
) {
  if (newStage === tender.stage) return;
  const isClosed = newStage === 'Won' || newStage === 'Lost';
  const historyTimestamp = isClosed && closedDate ? closedDateToMillis(closedDate) : Date.now();
  const becomingWon = newStage === 'Won';
  const firstTimeSubmitted = newStage === 'Submitted' && !tender.submittedDate && !!submittedDate;

  // Becoming Won turns this into an Active Project — see defaultActiveBranchOnWin's doc comment
  // for when it's left unassigned instead of defaulting to the submitting branch. Moving away
  // from Won (including to Lost) always clears it.
  await updateDoc(doc(db, 'tenders', tender.id), {
    stage: newStage,
    updatedAt: Date.now(),
    // Clear closedDate when moving back to an open stage, so stale dates don't linger.
    closedDate: isClosed ? (closedDate ?? null) : null,
    disqualifiedDate: null,
    activeBranch: becomingWon
      ? tender.activeBranch || defaultActiveBranchOnWin(tender.department, actor.role)
      : null,
    ...(firstTimeSubmitted ? { submittedDate } : {}),
    ...(firstTimeSubmitted && submissionExpiryDate ? { submissionExpiryDate } : {}),
  });
  await addHistoryEntry(
    tender.id,
    {
      type: 'stage_change',
      stage: newStage,
      fromStage: tender.stage,
      value: tender.tenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
    },
    historyTimestamp
  );
}

/**
 * Moves a New Lead straight to Disqualified Lead — the ONLY path into that stage. The "Disqualify"
 * button on a New Lead card (see TenderCard.tsx) is the sole caller, gated behind a
 * window.confirm() first. Deliberately NOT folded into the generic moveTenderStage() above:
 * TenderFormModal's Stage dropdown never offers 'Disqualified Lead' as a target, and
 * KanbanColumn disables dropping into that column entirely, so a disqualification can never
 * happen as a casual dropdown pick or an accidental drag — only this explicit, confirmed action.
 * Throws if the tender isn't currently New Lead (defense in depth behind the UI's own gating).
 * See requalifyTender() below for the (equally sealed) way back out.
 */
export async function disqualifyTender(tender: Tender, actor: Actor): Promise<void> {
  if (tender.stage !== 'New Lead') {
    throw new Error('Only a New Lead can be disqualified.');
  }
  const disqualifiedDate = new Date().toISOString().slice(0, 10);
  await updateDoc(doc(db, 'tenders', tender.id), {
    stage: 'Disqualified Lead',
    disqualifiedDate,
    updatedAt: Date.now(),
  });
  await addHistoryEntry(tender.id, {
    type: 'stage_change',
    stage: 'Disqualified Lead',
    fromStage: 'New Lead',
    value: tender.tenderValue,
    changedByUid: actor.uid,
    changedByName: actor.name,
    ownerUid: tender.ownerUid,
  });
}

/**
 * Moves a Disqualified Lead back to New Lead — the ONLY path out of that stage. The "Re-qualify"
 * button on a Disqualified Lead card (see TenderCard.tsx) is the sole caller, gated behind a
 * window.confirm() first. Disqualified Lead is deliberately sealed on both sides: KanbanColumn
 * makes its cards undraggable (so there's no drag-out path) and TenderFormModal locks the Stage
 * dropdown to read-only whenever a tender is in this stage (so there's no dropdown-out path
 * either) — this function, and only this function, is how a disqualified lead re-enters the
 * pipeline, and it always lands back at New Lead so the tender is "processed to go through the
 * pipeline accordingly" from the top rather than being droppable straight into some later stage.
 * Throws if the tender isn't currently Disqualified Lead (defense in depth behind the UI's own
 * gating).
 */
export async function requalifyTender(tender: Tender, actor: Actor): Promise<void> {
  if (tender.stage !== 'Disqualified Lead') {
    throw new Error('Only a Disqualified Lead can be re-qualified.');
  }
  await updateDoc(doc(db, 'tenders', tender.id), {
    stage: 'New Lead',
    disqualifiedDate: null,
    updatedAt: Date.now(),
  });
  await addHistoryEntry(tender.id, {
    type: 'stage_change',
    stage: 'New Lead',
    fromStage: 'Disqualified Lead',
    value: tender.tenderValue,
    changedByUid: actor.uid,
    changedByName: actor.name,
    ownerUid: tender.ownerUid,
  });
}

/**
 * Renews an Active Project's contract in place — extends `contractEnd` and, if the rate changed,
 * updates `tenderValue` — instead of closing the project out and re-Winning a fresh tender for
 * work that never actually stopped (see closeOutProject()'s doc comment for why that would be
 * the wrong move: it'd needlessly release the project's guards and disconnect it from its site).
 * `contractStart` is deliberately left untouched — a straight renewal continues the same
 * engagement, it doesn't start a new one.
 *
 * Callable by the tender's owner, an admin, or the Branch Manager currently running this
 * project (its `activeBranch`) — see firestore.rules' Won-stage branch-scoped update clause,
 * which now includes contractEnd/tenderValue alongside the other operational fields it already
 * let branch-mates and HQ touch. This is what lets RenewContractModal.tsx offer "Renew" on every
 * row of the Active Projects list: whoever's actually running the project day-to-day can renew
 * it, not only whoever originally sold it.
 *
 * Logs a `value_change` history entry only when the value actually changed (mirrors
 * updateTender()), so the pipeline-value trend chart reflects a real rate change without a
 * no-op entry cluttering history when a renewal keeps the same rate.
 */
export async function renewContract(
  tender: Tender,
  input: { contractEnd: string; tenderValue: number },
  actor: Actor
): Promise<void> {
  await updateDoc(doc(db, 'tenders', tender.id), {
    contractEnd: input.contractEnd,
    tenderValue: input.tenderValue,
    updatedAt: Date.now(),
  });
  if (input.tenderValue !== tender.tenderValue) {
    await addHistoryEntry(tender.id, {
      type: 'value_change',
      stage: tender.stage,
      value: input.tenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
      valueChangeReason: 'renewal',
    });
  }
}

/** Number of distinct 'YYYY-MM' calendar months from `fromISO` through `toISO`, inclusive (e.g.
 *  2026-09-15 through 2026-11-30 is 3: September, October, November) — used by
 *  addTenderEquipment() below to estimate how many months' billing a new equipment item still
 *  has left on the contract. Never negative (an item starting after the contract's own end
 *  contributes 0). */
export function wholeMonthsInclusive(fromISO: string, toISO: string): number {
  const [fy, fm] = fromISO.split('-').map(Number);
  const [ty, tm] = toISO.split('-').map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

/**
 * Declares one additional equipment/add-on item on a Won project (Active Projects > Project
 * Details > "Additional Equipment") — e.g. an e-bike or drone the client asked for, on top of
 * guard headcount. Unlike Branch Collection's site-level SiteEquipmentRate catalog (a plain
 * fallback list with no value tracking), this bumps the project's own tracked `tenderValue` by an
 * ESTIMATE of what the item adds to the deal's total worth over what's left of the contract —
 * `monthlyRate * quantity * wholeMonthsInclusive(startDate, contractEnd)` — and logs that bump as
 * a `value_change` history entry timestamped to `startDate` itself (not "now"), the same
 * mechanism renewContract() uses, so the Active Project Value Bridge places the increase in
 * whichever period the equipment actually started in — including a past period, for equipment
 * being backfilled after the fact.
 *
 * `startDate` is clamped to never be earlier than the tender's own contractStart — equipment
 * can't predate the contract it's billed under (the Project Details date picker already enforces
 * this; clamped again here as a second guard rail, same reasoning as InvoiceGenerator's own
 * headcount cap).
 *
 * Mirrors renewContract()'s own permission story: Firestore rules let a branch-mate (or HQ) on
 * this Won project's activeBranch write `tenderValue`/`additionalEquipment` and log a
 * `value_change` entry here without being the tender's owner/admin, same as a renewal.
 */
export async function addTenderEquipment(
  tender: Tender,
  input: { item: string; monthlyRate: number; quantity: number; startDate: string },
  actor: Actor
): Promise<void> {
  const startDate = input.startDate < tender.contractStart ? tender.contractStart : input.startDate;
  const monthsRemaining = wholeMonthsInclusive(startDate, tender.contractEnd);
  const valueContribution = input.monthlyRate * input.quantity * monthsRemaining;
  const newItem: TenderEquipmentItem = {
    id: crypto.randomUUID(),
    item: input.item,
    monthlyRate: input.monthlyRate,
    quantity: input.quantity,
    startDate,
    valueContribution,
    addedAt: Date.now(),
  };
  const newTenderValue = tender.tenderValue + valueContribution;

  await updateDoc(doc(db, 'tenders', tender.id), {
    additionalEquipment: arrayUnion(newItem),
    tenderValue: newTenderValue,
    updatedAt: Date.now(),
  });

  if (valueContribution !== 0) {
    await addHistoryEntry(
      tender.id,
      {
        type: 'value_change',
        stage: tender.stage,
        value: newTenderValue,
        changedByUid: actor.uid,
        changedByName: actor.name,
        ownerUid: tender.ownerUid,
        valueChangeReason: 'equipment_increase',
      },
      closedDateToMillis(startDate)
    );
  }
}

/**
 * Removes one equipment item declared via addTenderEquipment() above, reversing whatever is LEFT
 * of its `valueContribution` — the full amount, unless it was already partially reversed by
 * stopTenderEquipmentItem() below, in which case only `valueContribution - stopValueReversal`
 * remains to reverse (never a value re-derived from today's rate/quantity/contractEnd, which may
 * have since changed) — floored at 0 so a tenderValue manually lowered since can't go negative.
 * This history entry is logged at the moment of removal itself: a past period's bridge, already
 * generated while the item was active, stays exactly as it was; only this period onward reflects
 * the decrease.
 */
export async function removeTenderEquipmentItem(tender: Tender, itemId: string, actor: Actor): Promise<void> {
  const item = (tender.additionalEquipment || []).find((eq) => eq.id === itemId);
  if (!item) return;
  const remaining = item.valueContribution - (item.stopValueReversal || 0);
  const newTenderValue = Math.max(0, tender.tenderValue - remaining);

  await updateDoc(doc(db, 'tenders', tender.id), {
    additionalEquipment: arrayRemove(item),
    tenderValue: newTenderValue,
    updatedAt: Date.now(),
  });

  if (remaining !== 0) {
    await addHistoryEntry(tender.id, {
      type: 'value_change',
      stage: tender.stage,
      value: newTenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
      valueChangeReason: 'equipment_decrease',
    });
  }
}

/** yyyy-mm-dd for the 1st of the calendar month AFTER the given date's own month — e.g.
 *  2026-09-15 -> 2026-10-01. Used by stopTenderEquipmentItem() below to find how many WHOLE
 *  months are left to reverse: the month an item stops in is treated as already billed (it was
 *  deployed for at least part of it), so only months strictly after it count toward the
 *  reversal. */
function firstOfNextMonth(dateISO: string): string {
  const [y, m] = dateISO.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/**
 * Stops one equipment item's deployment mid-contract WITHOUT deleting it — the item stays in
 * `additionalEquipment`, marked with `stoppedDate`, so its original "Equipment Added" history
 * remains visible instead of being erased the way a full Remove would. Reverses only the
 * estimated value for the months after `stoppedDate` (`monthlyRate * quantity *
 * wholeMonthsInclusive(firstOfNextMonth(stoppedDate), contractEnd)`, capped at what the item is
 * still worth) — the month it stops in still counts as billed. Use this when equipment genuinely
 * stops being deployed to the site; use removeTenderEquipmentItem() instead to correct a mistake
 * (declared in error, wrong rate, etc.), which erases the item and its value contribution
 * entirely.
 *
 * `stopDate` is clamped to never be earlier than the item's own `startDate`. No-op (throws
 * instead) if the item is already stopped — stop it only once; a further correction goes through
 * Remove.
 */
export async function stopTenderEquipmentItem(
  tender: Tender,
  itemId: string,
  stopDate: string,
  actor: Actor
): Promise<void> {
  const item = (tender.additionalEquipment || []).find((eq) => eq.id === itemId);
  if (!item) return;
  if (item.stoppedDate) throw new Error('This equipment item has already been stopped.');

  const clampedStop = stopDate < item.startDate ? item.startDate : stopDate;
  const monthsAfterStop = wholeMonthsInclusive(firstOfNextMonth(clampedStop), tender.contractEnd);
  const reversal = Math.min(item.valueContribution, item.monthlyRate * item.quantity * monthsAfterStop);
  const newTenderValue = Math.max(0, tender.tenderValue - reversal);
  const updatedItem: TenderEquipmentItem = { ...item, stoppedDate: clampedStop, stopValueReversal: reversal };
  const newEquipment = (tender.additionalEquipment || []).map((eq) => (eq.id === itemId ? updatedItem : eq));

  await updateDoc(doc(db, 'tenders', tender.id), {
    additionalEquipment: newEquipment,
    tenderValue: newTenderValue,
    updatedAt: Date.now(),
  });

  if (reversal !== 0) {
    await addHistoryEntry(
      tender.id,
      {
        type: 'value_change',
        stage: tender.stage,
        value: newTenderValue,
        changedByUid: actor.uid,
        changedByName: actor.name,
        ownerUid: tender.ownerUid,
        valueChangeReason: 'equipment_decrease',
      },
      closedDateToMillis(clampedStop)
    );
  }
}

/** Standard assumed monthly billable hours for one guard (26 working days x 8 hours) — used
 *  ONLY to estimate a Guard Rate change's contribution to a project's tracked contract value
 *  (see applyGuardRateChange() below). Guard Rate is billed per actual man-hour worked (from
 *  Duty Roster), which varies month to month and isn't tracked as a fixed monthly figure the
 *  way equipment's own `monthlyRate` is — this constant makes that estimate possible, at the
 *  cost of being an approximation rather than an exact figure. */
export const STANDARD_MONTHLY_HOURS_PER_GUARD = 208;

/** The single "effective" RM/man-hour rate a Guard Rate configuration works out to — `guardRate`
 *  itself in 'same' mode, or the plain average of `guardRatePositions`' rates in 'multiple' mode
 *  (headcount isn't broken down per position, so a weighted average isn't available; this is
 *  the same approximation applyGuardRateChange() already accepts elsewhere). 0 when unset. */
export function effectiveGuardRate(
  mode: 'same' | 'multiple' | undefined,
  rate: number | undefined,
  positions: { name: string; rate: number }[] | undefined
): number {
  if (mode === 'multiple') {
    if (!positions || positions.length === 0) return 0;
    return positions.reduce((sum, p) => sum + p.rate, 0) / positions.length;
  }
  return rate ?? 0;
}

/**
 * Applies a Guard Rate change (Project Details > Guard Rate) to a Won project's tracked contract
 * value — the same "increasing contract value" story as addTenderEquipment(), except Guard Rate
 * is RM per man-hour rather than a fixed monthly fee, so there's no exact monthly total to
 * multiply by remaining months the way equipment has. This ESTIMATES it instead:
 * `(new effective rate - old effective rate) * STANDARD_MONTHLY_HOURS_PER_GUARD * guardsDeployed
 * * wholeMonthsInclusive(today, contractEnd)` — see effectiveGuardRate() above for what
 * "effective rate" means in 'multiple' mode.
 *
 * Deliberately a no-op (writes the new rate fields, but no tenderValue change and no history
 * entry) the FIRST time a rate is ever set on a project (`tender.guardRateMode` was previously
 * unset) — that's declaring a rate for invoicing, not a rate INCREASE, so it must never be
 * compared against an implicit baseline of RM 0.
 *
 * Logs its own `value_change` history entry (`valueChangeReason: 'guard_rate'`) only when the
 * estimate is non-zero, timestamped to "now" (a rate change takes effect going forward, never
 * backdated, unlike equipment's own startDate) — so the Active Project Value Bridge shows it as
 * its own "Guard Rate Change" bar. Same permission story as renewContract()/addTenderEquipment():
 * firestore.rules already lets a branch-mate (or HQ) on this Won project write guardRateMode/
 * guardRate/guardRatePositions/tenderValue together.
 */
export async function applyGuardRateChange(
  tender: Tender,
  input: {
    guardRateMode: 'same' | 'multiple';
    guardRate?: number;
    guardRatePositions?: { name: string; rate: number }[];
    guardsDeployed: number;
  },
  actor: Actor
): Promise<void> {
  const hadPriorRate = tender.guardRateMode != null;
  const newEffective = effectiveGuardRate(input.guardRateMode, input.guardRate, input.guardRatePositions);
  const oldEffective = hadPriorRate
    ? effectiveGuardRate(tender.guardRateMode, tender.guardRate, tender.guardRatePositions)
    : newEffective;

  const isRealChange = hadPriorRate && newEffective !== oldEffective;
  let valueDelta = 0;
  if (isRealChange) {
    const months = wholeMonthsInclusive(new Date().toISOString().slice(0, 10), tender.contractEnd);
    valueDelta = (newEffective - oldEffective) * STANDARD_MONTHLY_HOURS_PER_GUARD * input.guardsDeployed * months;
  }
  const newTenderValue = Math.max(0, tender.tenderValue + valueDelta);

  await updateDoc(doc(db, 'tenders', tender.id), {
    guardRateMode: input.guardRateMode,
    guardRate: input.guardRateMode === 'same' ? input.guardRate ?? 0 : 0,
    guardRatePositions: input.guardRateMode === 'multiple' ? input.guardRatePositions ?? [] : [],
    tenderValue: newTenderValue,
    updatedAt: Date.now(),
    // Shown as an inline note in Project Details (see lastGuardRateChange's doc comment in
    // types.ts) — set on any real rate change, even the rare case where valueDelta itself works
    // out to 0 (e.g. guardsDeployed is 0), since the rate itself still genuinely changed.
    ...(isRealChange
      ? { lastGuardRateChange: { fromRate: oldEffective, toRate: newEffective, changedAt: Date.now(), changedByName: actor.name } }
      : {}),
  });

  if (valueDelta !== 0) {
    await addHistoryEntry(tender.id, {
      type: 'value_change',
      stage: tender.stage,
      value: newTenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
      valueChangeReason: 'guard_rate',
    });
  }
}

/**
 * Multi-site support (Active Projects > Project Details > "Linked Sites") — a project whose
 * client has more than one worksite/roster under the SAME contract can link additional Duty
 * Roster sites to it via "+ Add Site" (see createTenderSite() just below). The functions after
 * it are the per-site equivalents of addTenderEquipment()/stopTenderEquipmentItem()/
 * removeTenderEquipmentItem()/applyGuardRateChange() above, operating on ONE additional site's
 * own tenders/{tenderId}/siteDetails/{dutyRosterSiteId} doc instead of the Tender document's
 * top-level fields — see TenderSiteDetails' doc comment in types.ts for the full data-model
 * rationale (the first/original site of every project keeps using the top-level fields
 * unchanged; only a SECOND-or-later linked site gets a siteDetails doc at all).
 *
 * Contract value (tenderValue) stays combined/shared at the Tender level regardless of which
 * site an equipment/rate change belongs to — every function below still updates
 * `tenders/{tenderId}`'s own tenderValue and logs the same value_change history entries
 * (equipment_increase/equipment_decrease/guard_rate) that the single-site functions do, so the
 * Active Project Value Bridge keeps working unchanged (combined across all of a project's
 * sites — splitting it per site is not part of this first slice).
 */

/**
 * Links a new Duty Roster site to this tender straight from Project Details' "+ Add Site" —
 * writes the exact same `sites/{id}` document shape public/duty-roster/index.html's own
 * createSite() does (same field set, same default shift pattern via defaultSite() there),
 * mirrored here so the new site opens normally the moment someone switches to the Duty Roster
 * tab: an empty guard list and a default DN/12h shift pattern ready to configure, same as any
 * site created the usual way. Deliberately does NOT navigate to Duty Roster or open anything —
 * roster setup (guards, shifts, the actual schedule) happens separately, straight through the
 * Duty Roster tab, whenever staff get to it.
 *
 * Branch is taken from the tender itself (activeBranch, falling back to department) rather than
 * asked for here — every linked site under one contract runs under the same branch as the
 * project. Returns the new site's id (Firestore's own doc id space, not Duty Roster's
 * newId("site") helper, which only that vanilla-JS app can generate — an ordinary auto-id
 * serves exactly the same purpose here).
 */
export async function createTenderSite(tender: Tender, siteName: string): Promise<string> {
  const branch = tender.activeBranch || tender.department || null;
  const ref = doc(collection(db, 'sites'));
  const nowIsoStr = new Date().toISOString();
  await setDoc(ref, {
    id: ref.id,
    name: siteName,
    branch,
    tenderId: tender.id,
    archived: false,
    archivedAt: null,
    guards: [],
    // Mirrors public/duty-roster/index.html's own defaultSite() — a DN (day/night) pattern,
    // one post per shift, standard 12h shifts starting 7am, 8 normal hours/day before OT.
    site: {
      pattern: 'DN',
      postsU: 1,
      postsDay: 1,
      postsNight: 1,
      postsWd: 1,
      postsWe: 1,
      postsWdDay: 1,
      postsWdNight: 1,
      postsWeDay: 1,
      postsWeNight: 1,
      shiftsWdDay: [12],
      shiftsWdNight: [12],
      shiftsWeDay: [12],
      shiftsWeNight: [12],
      nightStart: 19,
      hoursDay: 24,
      daysWeek: 7,
      shiftHrs: 12,
      rosterStart: 7,
      normalHoursPerDay: 8,
    },
    restRule: { restDaysPerWeek: 1, minRestHours: 12 },
    isSample: false,
    isTestData: false,
    createdAt: nowIsoStr,
    updatedAt: nowIsoStr,
  });
  return ref.id;
}

function tenderSiteDetailsRef(tenderId: string, siteId: string) {
  return doc(db, 'tenders', tenderId, 'siteDetails', siteId);
}

/** One-off read of an additional site's override doc — null if it hasn't been saved to yet
 *  (a freshly-created site via "+ Add Site" has none until its first Save). */
export async function getTenderSiteDetails(tenderId: string, siteId: string): Promise<TenderSiteDetails | null> {
  const snap = await getDoc(tenderSiteDetailsRef(tenderId, siteId));
  return snap.exists() ? (snap.data() as TenderSiteDetails) : null;
}

/** Saves an additional site's Location/Contact fields — the per-site equivalent of
 *  updateActiveProjectDetails() below, minus the fields (tenderDocNumber, scopeOfWork, etc.)
 *  that stay project-wide rather than per-site. Creates the siteDetails doc on first save. */
export async function saveTenderSiteLocationDetails(
  tenderId: string,
  siteId: string,
  siteName: string,
  branch: string | null,
  input: { location?: string; state?: string; city?: string; postcode?: string; contactPerson?: string }
): Promise<void> {
  await setDoc(
    tenderSiteDetailsRef(tenderId, siteId),
    {
      dutyRosterSiteId: siteId,
      siteName,
      branch: branch || null,
      ...input,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    },
    { merge: true }
  );
}

/** Per-site equivalent of addTenderEquipment() — see that function's doc comment for the value
 *  estimate/history logic, unchanged here except that the equipment list itself lives on the
 *  site's own siteDetails doc rather than the Tender document. */
export async function addTenderSiteEquipment(
  tender: Tender,
  siteId: string,
  siteName: string,
  branch: string | null,
  siteDetails: TenderSiteDetails | null,
  input: { item: string; monthlyRate: number; quantity: number; startDate: string },
  actor: Actor
): Promise<void> {
  const startDate = input.startDate < tender.contractStart ? tender.contractStart : input.startDate;
  const monthsRemaining = wholeMonthsInclusive(startDate, tender.contractEnd);
  const valueContribution = input.monthlyRate * input.quantity * monthsRemaining;
  const newItem: TenderEquipmentItem = {
    id: crypto.randomUUID(),
    item: input.item,
    monthlyRate: input.monthlyRate,
    quantity: input.quantity,
    startDate,
    valueContribution,
    addedAt: Date.now(),
  };
  const newEquipment = [...(siteDetails?.additionalEquipment || []), newItem];

  await setDoc(
    tenderSiteDetailsRef(tender.id, siteId),
    {
      dutyRosterSiteId: siteId,
      siteName: siteDetails?.siteName || siteName,
      branch: siteDetails?.branch ?? branch ?? null,
      additionalEquipment: newEquipment,
      updatedAt: Date.now(),
      createdAt: siteDetails?.createdAt || Date.now(),
    },
    { merge: true }
  );

  const newTenderValue = tender.tenderValue + valueContribution;
  await updateDoc(doc(db, 'tenders', tender.id), { tenderValue: newTenderValue, updatedAt: Date.now() });

  if (valueContribution !== 0) {
    await addHistoryEntry(
      tender.id,
      {
        type: 'value_change',
        stage: tender.stage,
        value: newTenderValue,
        changedByUid: actor.uid,
        changedByName: actor.name,
        ownerUid: tender.ownerUid,
        valueChangeReason: 'equipment_increase',
      },
      closedDateToMillis(startDate)
    );
  }
}

/** Per-site equivalent of stopTenderEquipmentItem() — see that function's doc comment. */
export async function stopTenderSiteEquipmentItem(
  tender: Tender,
  siteId: string,
  siteDetails: TenderSiteDetails,
  itemId: string,
  stopDate: string,
  actor: Actor
): Promise<void> {
  const item = (siteDetails.additionalEquipment || []).find((eq) => eq.id === itemId);
  if (!item) return;
  if (item.stoppedDate) throw new Error('This equipment item has already been stopped.');

  const clampedStop = stopDate < item.startDate ? item.startDate : stopDate;
  const monthsAfterStop = wholeMonthsInclusive(firstOfNextMonth(clampedStop), tender.contractEnd);
  const reversal = Math.min(item.valueContribution, item.monthlyRate * item.quantity * monthsAfterStop);
  const updatedItem: TenderEquipmentItem = { ...item, stoppedDate: clampedStop, stopValueReversal: reversal };
  const newEquipment = (siteDetails.additionalEquipment || []).map((eq) => (eq.id === itemId ? updatedItem : eq));

  await setDoc(tenderSiteDetailsRef(tender.id, siteId), { additionalEquipment: newEquipment, updatedAt: Date.now() }, { merge: true });

  const newTenderValue = Math.max(0, tender.tenderValue - reversal);
  await updateDoc(doc(db, 'tenders', tender.id), { tenderValue: newTenderValue, updatedAt: Date.now() });

  if (reversal !== 0) {
    await addHistoryEntry(
      tender.id,
      {
        type: 'value_change',
        stage: tender.stage,
        value: newTenderValue,
        changedByUid: actor.uid,
        changedByName: actor.name,
        ownerUid: tender.ownerUid,
        valueChangeReason: 'equipment_decrease',
      },
      closedDateToMillis(clampedStop)
    );
  }
}

/** Per-site equivalent of removeTenderEquipmentItem() — see that function's doc comment. */
export async function removeTenderSiteEquipmentItem(
  tender: Tender,
  siteId: string,
  siteDetails: TenderSiteDetails,
  itemId: string,
  actor: Actor
): Promise<void> {
  const item = (siteDetails.additionalEquipment || []).find((eq) => eq.id === itemId);
  if (!item) return;
  const remaining = item.valueContribution - (item.stopValueReversal || 0);
  const newEquipment = (siteDetails.additionalEquipment || []).filter((eq) => eq.id !== itemId);

  await setDoc(tenderSiteDetailsRef(tender.id, siteId), { additionalEquipment: newEquipment, updatedAt: Date.now() }, { merge: true });

  const newTenderValue = Math.max(0, tender.tenderValue - remaining);
  await updateDoc(doc(db, 'tenders', tender.id), { tenderValue: newTenderValue, updatedAt: Date.now() });

  if (remaining !== 0) {
    await addHistoryEntry(tender.id, {
      type: 'value_change',
      stage: tender.stage,
      value: newTenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
      valueChangeReason: 'equipment_decrease',
    });
  }
}

/** Per-site equivalent of applyGuardRateChange() — see that function's doc comment. `siteDetails`
 *  null (first-ever rate set for this site) is treated the same way as an unset
 *  tender.guardRateMode there: written, but no value/history change. */
export async function applyTenderSiteGuardRateChange(
  tender: Tender,
  siteId: string,
  siteName: string,
  branch: string | null,
  siteDetails: TenderSiteDetails | null,
  input: {
    guardRateMode: 'same' | 'multiple';
    guardRate?: number;
    guardRatePositions?: { name: string; rate: number }[];
    guardsDeployed: number;
  },
  actor: Actor
): Promise<void> {
  const hadPriorRate = siteDetails?.guardRateMode != null;
  const newEffective = effectiveGuardRate(input.guardRateMode, input.guardRate, input.guardRatePositions);
  const oldEffective = hadPriorRate
    ? effectiveGuardRate(siteDetails!.guardRateMode, siteDetails!.guardRate, siteDetails!.guardRatePositions)
    : newEffective;

  const isRealChange = hadPriorRate && newEffective !== oldEffective;
  let valueDelta = 0;
  if (isRealChange) {
    const months = wholeMonthsInclusive(new Date().toISOString().slice(0, 10), tender.contractEnd);
    valueDelta = (newEffective - oldEffective) * STANDARD_MONTHLY_HOURS_PER_GUARD * input.guardsDeployed * months;
  }

  await setDoc(
    tenderSiteDetailsRef(tender.id, siteId),
    {
      dutyRosterSiteId: siteId,
      siteName: siteDetails?.siteName || siteName,
      branch: siteDetails?.branch ?? branch ?? null,
      guardRateMode: input.guardRateMode,
      guardRate: input.guardRateMode === 'same' ? input.guardRate ?? 0 : 0,
      guardRatePositions: input.guardRateMode === 'multiple' ? input.guardRatePositions ?? [] : [],
      updatedAt: Date.now(),
      createdAt: siteDetails?.createdAt || Date.now(),
      ...(isRealChange
        ? { lastGuardRateChange: { fromRate: oldEffective, toRate: newEffective, changedAt: Date.now(), changedByName: actor.name } }
        : {}),
    },
    { merge: true }
  );

  if (valueDelta !== 0) {
    const newTenderValue = Math.max(0, tender.tenderValue + valueDelta);
    await updateDoc(doc(db, 'tenders', tender.id), { tenderValue: newTenderValue, updatedAt: Date.now() });
    await addHistoryEntry(tender.id, {
      type: 'value_change',
      stage: tender.stage,
      value: newTenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
      valueChangeReason: 'guard_rate',
    });
  }
}

/**
 * Corrects the recorded Won/Lost date for a tender that's already in a closed stage (no stage
 * change here — just backfilling or fixing when it actually happened). Logs a history entry at
 * the corrected timestamp so the pipeline-value trend chart re-reflects it.
 */
export async function setClosedDate(
  tender: Tender,
  closedDate: string,
  actor: { uid: string; name: string }
) {
  await updateDoc(doc(db, 'tenders', tender.id), { closedDate });
  await addHistoryEntry(
    tender.id,
    {
      type: 'stage_change',
      stage: tender.stage,
      fromStage: tender.stage,
      value: tender.tenderValue,
      changedByUid: actor.uid,
      changedByName: actor.name,
      ownerUid: tender.ownerUid,
    },
    closedDateToMillis(closedDate)
  );
}

/**
 * Sets a tender's submission date — either the very first entry (a Branch Manager keying it in
 * the moment their tender reaches Submitted) or an admin correcting an already-set one. The
 * caller (TenderFormModal) is what restricts WHO reaches this: the date input is only editable
 * there when it's unset, or when the signed-in user is admin. firestore.rules is the real
 * enforcement layer — it independently rejects a non-admin's attempt to change an already-set
 * submittedDate, so this function has no client-side branching of its own to get wrong. No
 * history entry: unlike closedDate (which the pipeline-value trend chart replays), nothing
 * currently reads submittedDate out of the history log — it's a plain field on the tender.
 */
export async function setSubmittedDate(tenderId: string, submittedDate: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { submittedDate, updatedAt: Date.now() });
}

/**
 * Sets (or clears, passing null) a tender's submission expiry date — see
 * Tender.submissionExpiryDate's doc comment in types.ts. Unlike setSubmittedDate() above, there's
 * no write-once/admin-only lock here: any owner/admin can correct it at any time from
 * TenderFormModal, since nothing currently depends on this value being immutable once set.
 */
export async function setSubmissionExpiryDate(tenderId: string, submissionExpiryDate: string | null) {
  await updateDoc(doc(db, 'tenders', tenderId), { submissionExpiryDate: submissionExpiryDate || null, updatedAt: Date.now() });
}

/**
 * Sets activeBranch directly, with no pending/accept step — for DepartmentRepairTool.tsx's
 * data-cleanup use only (fixing a tender that's missing or has a stale activeBranch), and for
 * the very first assignment of an unassigned Won tender (see handleBranchChange in
 * ActiveProjectsPage.tsx: nothing yet exists for a receiving branch to protect in either case,
 * so there's nothing to gain by routing it through requestReassignBranch()/acceptReassignment()
 * below). Never call this to MOVE an already-active project from one branch to another —
 * that's exactly the case those two exist to handle safely.
 */
export async function setActiveBranch(tenderId: string, activeBranch: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { activeBranch, updatedAt: Date.now() });
}

/**
 * Requests reassigning which branch is running an already-Won tender's active project —
 * admin-only, separate from the sales-attribution `department` field (see the doc comment on
 * Tender.activeBranch). Unlike setActiveBranch() above, `activeBranch` is deliberately left
 * untouched here: the project and its Duty Roster stay fully live under the CURRENT branch
 * until the RECEIVING branch's Branch Manager actively accepts the move via
 * acceptReassignment() — see the doc comment on Tender.pendingReassignment for why. No history
 * entry, same as setActiveBranch(): this doesn't change value or sales stage.
 */
export async function requestReassignBranch(tenderId: string, toBranch: string, fromBranch: string | null) {
  await updateDoc(doc(db, 'tenders', tenderId), {
    pendingReassignment: { toBranch, fromBranch: fromBranch || null, requestedAt: Date.now() },
    updatedAt: Date.now(),
  });
}

/** Retracts a reassignment request the receiving branch hasn't accepted yet — admin-only, e.g. to undo a mistaken pick. */
export async function cancelReassignment(tenderId: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { pendingReassignment: null, updatedAt: Date.now() });
}

/**
 * Called by the RECEIVING branch's Branch Manager to resolve a pending reassignment (see
 * requestReassignBranch()). `choice` decides what happens to the Duty Roster site already tied
 * to this tender via its `tenderId`:
 *  - 'bring-over': the existing site just moves to the new branch (its `branch` field changes) —
 *    same guards, schedule and history, nothing lost or recreated.
 *  - 'new': the existing site is archived and unlinked from this tender (`tenderId` cleared,
 *    `archived` set) — kept forever for Admin/HQ/Payroll history/audit, exactly like a
 *    closed-out project's site (see setLinkedSitesArchived() below), but no longer "the" site
 *    for this tender. The very next Duty Roster visit for this tender then creates a brand-new,
 *    empty site under the new branch on its own, via the existing ?tenderId= deep-link bootstrap
 *    (see handleTenderDeepLinkIfNeeded() in public/duty-roster/index.html) — no separate
 *    site-creation logic needed here.
 * The site write happens BEFORE the tender write on purpose: firestore.rules lets the receiving
 * Branch Manager touch this site only while the tender's pendingReassignment still names them as
 * the target, so clearing pendingReassignment first would lock them out mid-operation.
 */
export async function acceptReassignment(tenderId: string, toBranch: string, choice: 'bring-over' | 'new') {
  const snap = await getDocs(query(collection(db, 'sites'), where('tenderId', '==', tenderId)));
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(
        d.ref,
        choice === 'bring-over'
          ? { branch: toBranch, updatedAt: Date.now() }
          : { tenderId: null, archived: true, archivedAt: Date.now(), updatedAt: Date.now() }
      )
    )
  );
  await updateDoc(doc(db, 'tenders', tenderId), {
    activeBranch: toBranch,
    pendingReassignment: null,
    updatedAt: Date.now(),
  });
}

/**
 * One-time-per-tender backfill for Won tenders that predate the Active Projects feature and
 * so have no `activeBranch` set yet. Called opportunistically (not destructively — only touches
 * tenders missing the field) whenever an admin loads the Active Projects page, so branch-scoped
 * staff queries (which filter on activeBranch) start finding historical Won tenders too.
 * Skips HQ-submitted tenders — same reasoning as moveTenderStage's default: HQ doesn't run
 * active projects, so those are left unassigned for an admin to pick a branch explicitly rather
 * than being silently backfilled to "HQ".
 */
export async function backfillActiveBranch(tender: Tender) {
  if (tender.stage !== 'Won' || tender.activeBranch || tender.department === 'HQ') return;
  await updateDoc(doc(db, 'tenders', tender.id), { activeBranch: tender.department });
}

/**
 * Updates the Active Project detail fields (location, contact person, guards deployed, tender
 * document number) on a Won tender. Deliberately narrow — it never touches stage, value,
 * ownership or department — because Firestore rules allow non-owner branch-mates and HQ to call
 * this on a Won tender in their own activeBranch, whereas the rest of the tender stays locked to
 * its owner/admin. Blank strings are written as-is (clearing a field); omit a key entirely to
 * leave that field untouched.
 */
export async function updateActiveProjectDetails(
  tenderId: string,
  patch: Partial<{
    location: string;
    state: string;
    city: string;
    postcode: string;
    contactPerson: string;
    guardsDeployed: number;
    tenderDocNumber: string;
    scopeOfWork: string;
    clientAlias: string;
    clientAddress: string;
    guardRateMode: 'same' | 'multiple';
    guardRate: number;
    guardRatePositions: { name: string; rate: number }[];
  }>
) {
  const data: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) data[key] = value;
  }
  await updateDoc(doc(db, 'tenders', tenderId), data);
}

/**
 * Closes out an Active Project once its work is actually finished (typically once the contract
 * has ended, but nothing stops closing it out early). Deliberately mirrors `setActiveBranch` /
 * `updateActiveProjectDetails`: no history entry, because `stage` and `tenderValue` are untouched
 * — the tender keeps counting as Won revenue forever in Pipeline Analysis, staff performance,
 * brand breakdown, and the sales race charts. It just moves out of Active Projects (and its value
 * totals / breakdowns) and into Past Projects.
 *
 * Also releases any guards still deployed to this project's site(s) back into the Guard Pool
 * (see setLinkedSitesArchived() -> releaseGuardsFromSite() in services/guards.ts), so they're
 * immediately available to assign elsewhere instead of staying marked "deployed" against a
 * project that's no longer running.
 *
 * A contract simply being RENEWED — continuing at the same or a new rate with no real break in
 * work — is NOT a close-out: call updateTender() to extend `contractEnd` (and update
 * `tenderValue` if the rate changed, which logs its own value_change history entry) on this same
 * tender instead. Closing out and re-Winning a fresh tender for a renewal would needlessly
 * release its guards and disconnect it from its existing Duty Roster site for no reason, since
 * the work never actually stopped.
 */
export async function closeOutProject(tenderId: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { closedOut: true, closedOutAt: Date.now() });
  await setLinkedSitesArchived(tenderId, true);
}

/** Reverses closeOutProject — moves a Past Project back into Active Projects. */
export async function reopenProject(tenderId: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { closedOut: false, closedOutAt: null });
  await setLinkedSitesArchived(tenderId, false);
}

/**
 * Archives (or un-archives) every Duty Roster site linked to this tender via its `tenderId`
 * field (see public/duty-roster/index.html's data model and bootstrap code) — an archived site
 * drops out of the branch's active site picker there but keeps every bit of its data (schedules,
 * leave records, temporary-guard names and rates) intact for Admin/HQ/Payroll, and un-archives
 * itself automatically the moment the project is reopened. Best-effort and silently swallows
 * errors: a tender with no linked site at all (the normal case for anything predating this
 * feature, or an admin-managed site with no tenderId) is not an error, and a permissions hiccup
 * here must never block the close-out/reopen action itself, which is what the caller actually
 * cares about.
 */
async function setLinkedSitesArchived(tenderId: string, archived: boolean) {
  try {
    const snap = await getDocs(query(collection(db, 'sites'), where('tenderId', '==', tenderId)));
    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(
          d.ref,
          archived ? { archived: true, archivedAt: Date.now() } : { archived: false, archivedAt: null }
        )
      )
    );
    // The project these sites belong to is ending (close-out or delete, never a mere reopen) —
    // pull any guards still deployed here back into the Guard Pool instead of leaving them
    // stuck "deployed" against a site that's no longer active. Deliberately NOT mirrored when
    // un-archiving (archived === false, i.e. reopenProject()): a guard released here may already
    // have been reassigned elsewhere in the meantime, so auto-redeploying them back on reopen
    // would risk double-booking rather than reflecting reality — reopening only restores the
    // site, staff re-assign guards to it manually if the reopened project still needs them.
    if (archived) {
      await Promise.all(snap.docs.map((d) => releaseGuardsFromSite(d.id)));
    }
  } catch {
    // Best-effort — see doc comment above.
  }
}

/**
 * Deleting a tender must not leave its last known value "stuck" forever in the pipeline-value
 * trend (which is reconstructed by replaying history). So we first log a `deleted` marker —
 * value 0, excluded from every trend bucket — and only then remove the tender document itself.
 *
 * Also archives any Duty Roster site still linked to this tender (see setLinkedSitesArchived()
 * above) so a deleted tender doesn't leave an orphaned, fully-active site sitting in the branch's
 * site picker forever — mirrors what closeOutProject() already does when a project is merely
 * moved to Past Projects rather than deleted outright.
 */
export async function deleteTender(tender: Tender, actor: { uid: string; name: string }) {
  await addHistoryEntry(tender.id, {
    type: 'deleted',
    stage: tender.stage,
    value: 0,
    changedByUid: actor.uid,
    changedByName: actor.name,
    ownerUid: tender.ownerUid,
  });
  await setLinkedSitesArchived(tender.id, true);
  await deleteDoc(doc(db, 'tenders', tender.id));
}

const ARCHIVE_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * True once a Won/Lost/Disqualified Lead tender has been sitting in that stage for more than a
 * full year — PipelinePage's Sales Funnel board filters these out with this, and ArchivePage
 * lists exactly the ones it returns true for. Purely a computed/display concern: this app has no
 * backend scheduler (no Cloud Functions), so nothing is ever written when a tender crosses the
 * threshold — it just quietly stops showing on the board the next time anyone loads it. Every
 * other view (Pipeline Analysis, Active/Past Projects, this tender's own history) is completely
 * unaffected and keeps counting it exactly as before — same non-destructive spirit as
 * Tender.closedOut.
 */
export function isTenderArchived(tender: Tender, asOf: number = Date.now()): boolean {
  const dateStr =
    tender.stage === 'Disqualified Lead'
      ? tender.disqualifiedDate
      : tender.stage === 'Won' || tender.stage === 'Lost'
        ? tender.closedDate
        : null;
  if (!dateStr) return false;
  const at = closedDateToMillis(dateStr);
  return Number.isFinite(at) && asOf - at > ARCHIVE_AFTER_MS;
}

export function tsToMillis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return Date.now();
}
