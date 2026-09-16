import { addDoc, arrayUnion, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { shouldStampTestData } from './settings';
import type { TaskPriority } from '../types';

function tasksCollection() {
  return collection(db, 'tasks');
}

export interface AssignTaskInput {
  title: string;
  description?: string;
  department: string;
  assigneeUid: string;
  assigneeName: string;
  priority: TaskPriority;
  createdByUid: string;
  createdByName: string;
}

/** Creates a brand-new task in the 'open' state — see the StaffTask status flow doc comment in
 *  types.ts. firestore.rules' /tasks create rule independently re-checks that the assignee is
 *  really an Operation Staff account in this same department, so a manager can't point a task at
 *  a stray/fabricated uid even if this client-side call were bypassed. */
export async function assignTask(input: AssignTaskInput) {
  await addDoc(tasksCollection(), {
    title: input.title,
    description: input.description || '',
    department: input.department,
    assigneeUid: input.assigneeUid,
    assigneeName: input.assigneeName,
    priority: input.priority,
    status: 'open',
    createdAt: Date.now(),
    createdByUid: input.createdByUid,
    createdByName: input.createdByName,
    staffCompletedAt: null,
    closedAt: null,
    closedByName: null,
    progressUpdates: [],
    isTestData: await shouldStampTestData(),
  });
}

/** Manager/admin only — see firestore.rules, which additionally only allows this while the task
 *  isn't already 'closed' (a closed task's priority is frozen, same as everything else about it). */
export async function updateTaskPriority(taskId: string, priority: TaskPriority) {
  await updateDoc(doc(db, 'tasks', taskId), { priority });
}

/** The assignee marks their OWN task done — moves 'open' -> 'staffCompleted' and stamps
 *  staffCompletedAt (shown as the task's "Close Date" in the list). Does NOT close the task; a
 *  Branch Manager/admin still has to confirm via closeTask() below before it counts toward the
 *  Completed stat tile. firestore.rules only allows this transition by the task's own assignee. */
export async function markTaskDone(taskId: string) {
  await updateDoc(doc(db, 'tasks', taskId), {
    status: 'staffCompleted',
    staffCompletedAt: Date.now(),
  });
}

/** Manager/admin confirms a staff-completed task is genuinely done — moves 'staffCompleted' ->
 *  'closed' and stamps closedAt/closedByName. Only ever callable from 'staffCompleted' — see
 *  firestore.rules, which enforces the same transition server-side. closedAt is what determines
 *  which calendar month this task counts toward on the Completed stat tile/list. */
export async function closeTask(taskId: string, closedByName: string) {
  await updateDoc(doc(db, 'tasks', taskId), {
    status: 'closed',
    closedAt: Date.now(),
    closedByName,
  });
}

/** Manager/admin sends a staff-completed task back to 'open' — for when the work actually isn't
 *  done yet. Clears staffCompletedAt so the assignee can mark it done again once it really is. */
export async function reopenTask(taskId: string) {
  await updateDoc(doc(db, 'tasks', taskId), {
    status: 'open',
    staffCompletedAt: null,
  });
}

/** Manager/admin only (see firestore.rules) — for cleaning up a task assigned by mistake. */
export async function deleteTask(taskId: string) {
  await deleteDoc(doc(db, 'tasks', taskId));
}

/** Appends one entry to a task's progress log — the assignee or a manager/admin (own
 *  department) can post, any time before the task is 'closed'; see firestore.rules. Entries
 *  are never edited or removed, only ever appended (arrayUnion), so this is the full history. */
export async function addProgressUpdate(taskId: string, entry: { text: string; byUid: string; byName: string }) {
  await updateDoc(doc(db, 'tasks', taskId), {
    progressUpdates: arrayUnion({ text: entry.text, byUid: entry.byUid, byName: entry.byName, at: Date.now() }),
  });
}
