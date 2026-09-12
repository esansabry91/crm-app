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
import { releaseGuardsFromSite } from './guards';
import { shouldStampTestData } from './settings';
import type { Role, Stage, Tender } from '../types';
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
  // See Tender.isTestData's doc comment in types.ts — stamped once, at creation, from whatever
  // Testing Mode was set to at that moment, OR'd with whether the creating account is itself a
  // 'developer' account (see shouldStampTestData()'s doc comment in services/settings.ts).
  const isTestData = await shouldStampTestData(actor.role);

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
    disqualifiedDate: null,
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
