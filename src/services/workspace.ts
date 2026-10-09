/**
 * My Workspace — Today Tasks + Weekly Planner's own data: a user's day-by-day task list and the
 * once-a-day "I've reviewed today's priorities" confirmation. Ported from gdsb-portal's
 * apps/worker/src/routes/workspace.ts (its /tasks, /day, /day/review endpoints — the Goals/
 * Commissions/KPI endpoints in that same file are out of scope here, see workspacePlannerOnly()),
 * translated from a Hono/D1 REST API into direct Firestore reads/writes.
 *
 * Every query here filters by `uid == me` only (no date range) and lets the caller slice/sort
 * client-side — same "equality-only, sort client-side" convention useUsers.ts documents, so this
 * never needs a composite index. A user's own task/day-review volume is small enough that
 * fetching all of it at once is cheap, the same reasoning subscribeAllEmployeeFeedback() uses.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { workspaceTaskPriorityLocked, type WorkspaceDay, type WorkspaceTask, type WorkspaceTaskPriority } from '../types';
import { todayIso, tomorrowIso } from '../utils/workspaceDates';

function tasksCollection() {
  return collection(db, 'workspaceTasks');
}

function dayDocId(uid: string, date: string): string {
  return `${uid}_${date}`;
}

function dayDoc(uid: string, date: string) {
  return doc(db, 'workspaceDay', dayDocId(uid, date));
}

/** Every task this user has ever created, any date, newest-first within a day by position.
 *  Callers slice by date range client-side (see Planner.tsx / TodayTasks.tsx). */
export function subscribeMyWorkspaceTasks(
  uid: string,
  callback: (tasks: WorkspaceTask[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(tasksCollection(), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkspaceTask, 'id'>) }));
      rows.sort((a, b) => (a.date === b.date ? a.position - b.position : a.date < b.date ? -1 : 1));
      callback(rows);
    },
    (err) => onError?.(err)
  );
}

/** Live listener on a single day's review state — see WorkspaceDay in types.ts. `callback(null)`
 *  means the user hasn't reviewed that day's priorities yet (no doc exists). */
export function subscribeWorkspaceDay(
  uid: string,
  date: string,
  callback: (day: WorkspaceDay | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    dayDoc(uid, date),
    (snap) => callback(snap.exists() ? (snap.data() as WorkspaceDay) : null),
    (err) => onError?.(err)
  );
}

/** Appends a new task to the end of the given date's list (position = current max + 1). */
export async function addWorkspaceTask(input: { uid: string; date: string; title: string; existingOnDate: WorkspaceTask[] }): Promise<void> {
  const nextPosition = input.existingOnDate.reduce((max, t) => Math.max(max, t.position), -1) + 1;
  const now = Date.now();
  await addDoc(tasksCollection(), {
    uid: input.uid,
    date: input.date,
    title: input.title.trim(),
    done: false,
    position: nextPosition,
    priority: 3 satisfies WorkspaceTaskPriority,
    createdAt: now,
    updatedAt: now,
  });
}

export async function renameWorkspaceTask(taskId: string, title: string): Promise<void> {
  await updateDoc(doc(tasksCollection(), taskId), { title: title.trim(), updatedAt: Date.now() });
}

export async function toggleWorkspaceTaskDone(taskId: string, done: boolean): Promise<void> {
  await updateDoc(doc(tasksCollection(), taskId), { done, updatedAt: Date.now() });
}

/**
 * Changes a task's priority — the CALLER is responsible for checking workspaceTaskPriorityLocked()
 * first (the UI disables the control entirely once locked; see PriorityLights.tsx), but this also
 * re-derives the same lock client-side as a safety net against a stale/buggy caller. There's no
 * backend here to enforce this the way gdsb-portal's workspace.ts PATCH /tasks/:id does
 * server-side, so this is a UI-level safeguard only, not a security boundary — nothing sensitive
 * hinges on a priority value.
 */
export async function updateWorkspaceTaskPriority(task: WorkspaceTask, priority: WorkspaceTaskPriority, reviewedToday: boolean): Promise<void> {
  const today = todayIso();
  const tomorrow = tomorrowIso();
  if (workspaceTaskPriorityLocked(task.date, today, tomorrow, reviewedToday)) {
    throw new Error('This task’s priority is locked for today.');
  }
  await updateDoc(doc(tasksCollection(), task.id), { priority, updatedAt: Date.now() });
}

export async function deleteWorkspaceTask(taskId: string): Promise<void> {
  await deleteDoc(doc(tasksCollection(), taskId));
}

/** Reassigns a task to a different date (drag-to-another-day in the weekly planner) — moved to
 *  the end of the target date's list. */
export async function moveWorkspaceTaskToDate(taskId: string, date: string, existingOnDate: WorkspaceTask[]): Promise<void> {
  const nextPosition = existingOnDate.reduce((max, t) => Math.max(max, t.position), -1) + 1;
  await updateDoc(doc(tasksCollection(), taskId), { date, position: nextPosition, updatedAt: Date.now() });
}

/** Persists a new top-to-bottom order for one date's tasks (drag-to-reorder within a day). */
export async function reorderWorkspaceTasks(orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  orderedIds.forEach((id, i) => batch.update(doc(tasksCollection(), id), { position: i, updatedAt: Date.now() }));
  await batch.commit();
}

/**
 * Confirms today's priorities are reviewed — idempotent (first confirmation of the day wins; see
 * firestore.rules' /workspaceDay update rule, which only allows this while prioritiesReviewedAt
 * is still unset). setDoc+merge works for both the create (doc doesn't exist yet) and update
 * (doc exists, field still null) cases, since uid/date themselves never change value.
 */
export async function confirmTodayPriorities(uid: string, date: string): Promise<void> {
  await setDoc(dayDoc(uid, date), { uid, date, prioritiesReviewedAt: Date.now() }, { merge: true });
}
