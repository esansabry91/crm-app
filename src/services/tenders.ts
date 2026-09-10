import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Role, Stage, Tender } from '../types';

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
  if (actorRole === 'admin') return null;
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
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Won or Lost. Used to backfill history. */
  closedDate?: string;
  /** ISO date (yyyy-mm-dd) — only meaningful when stage is Submitted or later. See Tender.submittedDate. */
  submittedDate?: string;
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
  actor: Actor
): Promise<string> {
  const now = Date.now();
  const isClosed = input.stage === 'Won' || input.stage === 'Lost';
  const historyTimestamp = isClosed && input.closedDate ? closedDateToMillis(input.closedDate) : now;

  // Firestore's addDoc() rejects fields explicitly set to `undefined` — closedDate/submittedDate
  // are optional and undefined for most tenders, so they must be omitted entirely rather than
  // spread in as `closedDate: undefined`.
  const { closedDate, submittedDate, ...rest } = input;
  const docRef = await addDoc(collection(db, 'tenders'), {
    ...rest,
    ...(closedDate ? { closedDate } : {}),
    ...(submittedDate ? { submittedDate } : {}),
    // A tender can be created directly in the Won stage (not just moved there later) — give it
    // the same activeBranch default moveTenderStage would, so it doesn't rely on the opportunistic
    // backfill (which has no idea who created it) to fill this in afterwards.
    ...(input.stage === 'Won' ? { activeBranch: defaultActiveBranchOnWin(input.department, actor.role) } : {}),
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
 */
export async function moveTenderStage(
  tender: Tender,
  newStage: Stage,
  actor: Actor,
  closedDate?: string,
  submittedDate?: string
) {
  if (newStage === tender.stage) return;
  const isClosed = newStage === 'Won' || newStage === 'Lost';
  const historyTimestamp = isClosed && closedDate ? closedDateToMillis(closedDate) : Date.now();
  const becomingWon = newStage === 'Won';

  // Becoming Won turns this into an Active Project — see defaultActiveBranchOnWin's doc comment
  // for when it's left unassigned instead of defaulting to the submitting branch. Moving away
  // from Won (including to Lost) always clears it.
  await updateDoc(doc(db, 'tenders', tender.id), {
    stage: newStage,
    updatedAt: Date.now(),
    // Clear closedDate when moving back to an open stage, so stale dates don't linger.
    closedDate: isClosed ? (closedDate ?? null) : null,
    activeBranch: becomingWon
      ? tender.activeBranch || defaultActiveBranchOnWin(tender.department, actor.role)
      : null,
    ...(newStage === 'Submitted' && !tender.submittedDate && submittedDate ? { submittedDate } : {}),
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
  } catch {
    // Best-effort — see doc comment above.
  }
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
