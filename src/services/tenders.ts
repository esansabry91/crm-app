import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Stage, Tender } from '../types';

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
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Won or Lost. Used to backfill history. */
  closedDate?: string;
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

/** yyyy-mm-dd -> epoch millis at local noon (avoids timezone edge cases shifting it to the wrong day). */
function closedDateToMillis(closedDate: string): number {
  return new Date(`${closedDate}T12:00:00`).getTime();
}

export async function createTender(
  input: NewTenderInput,
  actor: { uid: string; name: string }
): Promise<string> {
  const now = Date.now();
  const isClosed = input.stage === 'Won' || input.stage === 'Lost';
  const historyTimestamp = isClosed && input.closedDate ? closedDateToMillis(input.closedDate) : now;

  // Firestore's addDoc() rejects fields explicitly set to `undefined` — closedDate is optional
  // and undefined for every open-stage tender, so it must be omitted entirely rather than spread
  // in as `closedDate: undefined`.
  const { closedDate, ...rest } = input;
  const docRef = await addDoc(collection(db, 'tenders'), {
    ...rest,
    ...(closedDate ? { closedDate } : {}),
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
  actor: { uid: string; name: string },
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
 */
export async function moveTenderStage(
  tender: Tender,
  newStage: Stage,
  actor: { uid: string; name: string },
  closedDate?: string
) {
  if (newStage === tender.stage) return;
  const isClosed = newStage === 'Won' || newStage === 'Lost';
  const historyTimestamp = isClosed && closedDate ? closedDateToMillis(closedDate) : Date.now();
  const becomingWon = newStage === 'Won';

  // Becoming Won turns this into an Active Project — default its operational branch to wherever
  // it was submitted, EXCEPT when it was submitted by HQ: HQ doesn't run active projects itself
  // (see the doc comment on Tender.activeBranch), so an HQ-won tender is left unassigned
  // (activeBranch null) and shows an empty "Select branch" placeholder in Active Projects,
  // forcing an admin to explicitly pick which branch will actually run it rather than silently
  // defaulting to "HQ". Moving away from Won (including to Lost) always clears it.
  const defaultActiveBranch = tender.department === 'HQ' ? null : tender.department;
  await updateDoc(doc(db, 'tenders', tender.id), {
    stage: newStage,
    updatedAt: Date.now(),
    // Clear closedDate when moving back to an open stage, so stale dates don't linger.
    closedDate: isClosed ? (closedDate ?? null) : null,
    activeBranch: becomingWon ? tender.activeBranch || defaultActiveBranch : null,
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
 * Reassigns which branch is running an already-Won tender's active project — an admin-only
 * operational move, separate from the sales-attribution `department` field (see the doc comment
 * on Tender.activeBranch). No history entry: this doesn't change value or sales stage, just
 * which branch's Active Projects list it shows up in.
 */
export async function setActiveBranch(tenderId: string, activeBranch: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { activeBranch });
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
    contactPerson: string;
    guardsDeployed: number;
    tenderDocNumber: string;
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
 * — the tender keeps counting as Won revenue forever in Performance Analysis, staff performance,
 * brand breakdown, and the sales race charts. It just moves out of Active Projects (and its value
 * totals / breakdowns) and into Past Projects.
 */
export async function closeOutProject(tenderId: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { closedOut: true, closedOutAt: Date.now() });
}

/** Reverses closeOutProject — moves a Past Project back into Active Projects. */
export async function reopenProject(tenderId: string) {
  await updateDoc(doc(db, 'tenders', tenderId), { closedOut: false, closedOutAt: null });
}

/**
 * Deleting a tender must not leave its last known value "stuck" forever in the pipeline-value
 * trend (which is reconstructed by replaying history). So we first log a `deleted` marker —
 * value 0, excluded from every trend bucket — and only then remove the tender document itself.
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
  await deleteDoc(doc(db, 'tenders', tender.id));
}

export function tsToMillis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === 'number') return v;
  return Date.now();
}
