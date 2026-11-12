import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { localTodayIso } from '../utils/calendarDays';
import { shouldStampTestData } from './settings';
import type { TaskPriority, TaskTemplate } from '../types';

function tasksCollection() {
  return collection(db, 'tasks');
}

function taskTemplatesCollection() {
  return collection(db, 'taskTemplates');
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
  /** ISO date (yyyy-mm-dd), or omitted for no deadline — see Tender.deadline's doc comment in
   *  types.ts. Never passed when assigning via a recurring template; that path computes its own
   *  from the template's dueDay instead (see ensureRecurringTasksForCurrentMonth() below). */
  deadline?: string;
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
    deadline: input.deadline || null,
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

/** Manager/admin only, same pre-close window as updateTaskPriority() above — corrects or clears
 *  (pass null) a task's deadline any time before it's closed. */
export async function updateTaskDeadline(taskId: string, deadline: string | null) {
  await updateDoc(doc(db, 'tasks', taskId), { deadline });
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

// ---- Recurring task templates (see TaskTemplate's doc comment in types.ts) ----

export interface RecurringTaskTemplateInput {
  title: string;
  description?: string;
  department: string;
  assigneeUid: string;
  assigneeName: string;
  priority: TaskPriority;
  /** Day of month (1–28) each generated instance is due — omit for no deadline. */
  dueDay?: number;
  createdByUid: string;
  createdByName: string;
}

/** Sets up a new recurring template — the Branch Manager/admin's ONE-TIME action (see
 *  TaskTemplate's doc comment). Deliberately does NOT also generate this month's instance here:
 *  TaskBoardPage.tsx calls ensureRecurringTasksForCurrentMonth() against the live template list
 *  right after, which generates it the same way every later month will, so there's exactly one
 *  code path for "a template needs this month's instance" rather than two. */
export async function createRecurringTaskTemplate(input: RecurringTaskTemplateInput): Promise<string> {
  const docRef = await addDoc(taskTemplatesCollection(), {
    title: input.title,
    description: input.description || '',
    department: input.department,
    assigneeUid: input.assigneeUid,
    assigneeName: input.assigneeName,
    priority: input.priority,
    ...(input.dueDay ? { dueDay: input.dueDay } : {}),
    active: true,
    createdAt: Date.now(),
    createdByUid: input.createdByUid,
    createdByName: input.createdByName,
    lastGeneratedMonth: null,
  });
  return docRef.id;
}

/** Turns off future monthly generation — see TaskTemplate.active's doc comment. Never touches
 *  any instance already generated from it; those are independent /tasks docs by then. */
export async function stopRecurringTaskTemplate(templateId: string) {
  await updateDoc(doc(db, 'taskTemplates', templateId), { active: false });
}

/** Admin/owning-manager only (see firestore.rules) — for removing a template set up by mistake.
 *  Same as stopping it, this never touches any instance already generated. */
export async function deleteRecurringTaskTemplate(templateId: string) {
  await deleteDoc(doc(db, 'taskTemplates', templateId));
}

/** `dueDay` (1–31, as typed into the form) -> that day within `monthIso` ('YYYY-MM'), clamped to
 *  the actual last day of that month — so a template due on the 31st still resolves to a real
 *  date (the 30th, or the 28th/29th in February) instead of overflowing into next month. */
function clampedMonthlyDueDate(dueDay: number, monthIso: string): string {
  const [year, month] = monthIso.split('-').map(Number);
  const lastDayOfMonth = new Date(year, month, 0).getDate(); // day 0 of next month = last day of this one
  const day = Math.min(Math.max(1, Math.round(dueDay)), lastDayOfMonth);
  return `${monthIso}-${String(day).padStart(2, '0')}`;
}

/**
 * Generates this month's instance for every active template in `templates` that doesn't already
 * have one (lastGeneratedMonth !== the current month) — see TaskTemplate's own doc comment for
 * the overall mechanism. Safe to call on every Task Board load: each template is handled in its
 * own Firestore transaction that re-reads the template fresh, so if two managers' browsers both
 * call this around the same moment, whichever transaction commits first advances
 * lastGeneratedMonth, and the second one sees the current month already recorded and silently
 * no-ops instead of creating a duplicate task — optimistic-concurrency on the template doc itself
 * is what Firestore uses to guarantee only one of them actually commits a change.
 *
 * A template whose owning branch this caller isn't allowed to create tasks for at all (see
 * firestore.rules' /tasks create rule — e.g. a plain staff account's session, which should never
 * even reach this function; TaskBoardPage.tsx only calls it for canManage sessions) simply fails
 * its own transaction with permission-denied; caught and skipped per-template so one bad
 * template never blocks the rest from generating.
 */
export async function ensureRecurringTasksForCurrentMonth(templates: TaskTemplate[]): Promise<void> {
  const monthIso = localTodayIso().slice(0, 7); // 'YYYY-MM'
  const isTestData = await shouldStampTestData();
  for (const template of templates) {
    if (!template.active || template.lastGeneratedMonth === monthIso) continue;
    try {
      await runTransaction(db, async (trx) => {
        const templateRef = doc(db, 'taskTemplates', template.id);
        const snap = await trx.get(templateRef);
        if (!snap.exists()) return;
        const data = snap.data() as Omit<TaskTemplate, 'id'>;
        if (!data.active || data.lastGeneratedMonth === monthIso) return; // already handled elsewhere
        const newTaskRef = doc(tasksCollection());
        trx.set(newTaskRef, {
          title: data.title,
          description: data.description || '',
          department: data.department,
          assigneeUid: data.assigneeUid,
          assigneeName: data.assigneeName,
          priority: data.priority,
          status: 'open',
          deadline: data.dueDay ? clampedMonthlyDueDate(data.dueDay, monthIso) : null,
          templateId: template.id,
          createdAt: Date.now(),
          createdByUid: data.createdByUid,
          createdByName: data.createdByName,
          staffCompletedAt: null,
          closedAt: null,
          closedByName: null,
          progressUpdates: [],
          isTestData,
        });
        trx.update(templateRef, { lastGeneratedMonth: monthIso });
      });
    } catch (err) {
      console.error('ensureRecurringTasksForCurrentMonth', template.id, err);
    }
  }
}
