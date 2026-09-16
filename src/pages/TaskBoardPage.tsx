import { Fragment, useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { useTasks } from '../hooks/useTasks';
import { useUsers } from '../hooks/useUsers';
import { useBranches } from '../hooks/useBranches';
import StatCard from '../components/analytics/StatCard';
import { addProgressUpdate, assignTask, closeTask, deleteTask, markTaskDone, reopenTask, updateTaskPriority } from '../services/tasks';
import type { StaffTask, TaskPriority } from '../types';
import { isAdminRole } from '../types';
import { formatDateTime } from '../utils/format';

const ALL_BRANCHES = '__all__';
const ALL_ASSIGNEES = '__all__';

/** True if a timestamp falls in the current calendar month — drives the Completed stat
 *  tile/list's "resets every 1st" behavior (see closedAt's doc comment on StaffTask in
 *  types.ts). Nothing is ever deleted for this — a task closed last month still exists in
 *  Firestore, it just stops showing up here once the month rolls over. */
function isThisMonth(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function priorityBadgeClass(priority: TaskPriority): string {
  switch (priority) {
    case 'High':
      return 'bg-rose-50 text-rose-600';
    case 'Medium':
      return 'bg-amber-50 text-amber-600';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

export default function TaskBoardPage() {
  const { profile } = useAuth();
  const { tasks, loading } = useTasks();
  const { users } = useUsers();
  const { branches } = useBranches();

  const isManager = profile?.role === 'branchManager';
  const isAdmin = isAdminRole(profile?.role);
  // Assign / set priority / close / reopen / delete — a Branch Manager (own branch, enforced
  // server-side by firestore.rules) or an admin-tier account (any branch).
  const canManage = isManager || isAdmin;
  const isStaff = profile?.role === 'dutyStaff';

  const [view, setView] = useState<'open' | 'completed'>('open');
  const [toast, setToast] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignDept, setAssignDept] = useState('');
  const [assigneeUid, setAssigneeUid] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin-only branch filter for the list — a Branch Manager never needs one, since
  // firestore.rules already only ever hands them their own department's tasks.
  const [branchFilter, setBranchFilter] = useState<string>(ALL_BRANCHES);
  // Assignee/priority filters narrow what's shown in the table only — the stat tiles above
  // always reflect the true Open/Completed/Productivity totals, independent of these.
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL_ASSIGNEES);
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all');
  // Which row's progress log is currently expanded (one at a time) — and the draft text for
  // the new-entry textarea inside it.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [progressDraft, setProgressDraft] = useState('');
  const [progressBusy, setProgressBusy] = useState(false);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 3500);
  }

  const effectiveAssignDept = isManager ? profile?.department || '' : assignDept;

  const assigneeOptions = useMemo(
    () =>
      users
        .filter((u) => u.role === 'dutyStaff' && u.active !== false && u.department === effectiveAssignDept)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users, effectiveAssignDept]
  );

  const visibleTasks = useMemo(
    () => (isAdmin && branchFilter !== ALL_BRANCHES ? tasks.filter((t) => t.department === branchFilter) : tasks),
    [tasks, isAdmin, branchFilter]
  );

  // "Open" never resets on its own — a task assigned last month and still not closed is exactly
  // as open today as it was then. Includes 'staffCompleted' (assignee says done, manager hasn't
  // confirmed yet), since it still isn't actually closed.
  const openTasks = useMemo(
    () =>
      visibleTasks
        .filter((t) => t.status === 'open' || t.status === 'staffCompleted')
        .sort((a, b) => b.createdAt - a.createdAt),
    [visibleTasks]
  );
  const awaitingConfirmationCount = useMemo(
    () => openTasks.filter((t) => t.status === 'staffCompleted').length,
    [openTasks]
  );

  // "Completed" is scoped to closedAt falling in the current calendar month — this is the part
  // that resets every 1st. A task closed in an earlier month simply stops matching here; it's
  // never deleted, just no longer counted/shown on this tile.
  const completedThisMonth = useMemo(
    () =>
      visibleTasks
        .filter((t) => t.status === 'closed' && t.closedAt != null && isThisMonth(t.closedAt))
        .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0)),
    [visibleTasks]
  );

  // Everyone who currently has at least one task in scope — built from the (unfiltered)
  // open+completed sets, not the full staff roster, so the dropdown never lists someone with
  // nothing assigned right now.
  const assigneeFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of [...openTasks, ...completedThisMonth]) {
      map.set(t.assigneeUid, t.assigneeName);
    }
    return Array.from(map.entries())
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [openTasks, completedThisMonth]);

  // Narrow what's actually rendered in the table — the Open/Completed COUNTS on the stat tiles
  // above stay unfiltered (true totals); only the list itself, and the tab labels beside it,
  // reflect these two filters.
  const filteredOpenTasks = useMemo(
    () =>
      openTasks.filter(
        (t) =>
          (assigneeFilter === ALL_ASSIGNEES || t.assigneeUid === assigneeFilter) &&
          (priorityFilter === 'all' || t.priority === priorityFilter)
      ),
    [openTasks, assigneeFilter, priorityFilter]
  );
  const filteredCompletedTasks = useMemo(
    () =>
      completedThisMonth.filter(
        (t) =>
          (assigneeFilter === ALL_ASSIGNEES || t.assigneeUid === assigneeFilter) &&
          (priorityFilter === 'all' || t.priority === priorityFilter)
      ),
    [completedThisMonth, assigneeFilter, priorityFilter]
  );

  // Of everything currently relevant (this month's closures + the standing open backlog), what
  // fraction has actually been finished. Deliberately uses the same two numbers as the tiles
  // beside it, so the figure is easy to sanity-check at a glance.
  const productivity =
    openTasks.length + completedThisMonth.length === 0
      ? null
      : Math.round((completedThisMonth.length / (openTasks.length + completedThisMonth.length)) * 100);

  function resetForm() {
    setTitle('');
    setDescription('');
    setAssignDept(isManager ? profile?.department || '' : '');
    setAssigneeUid('');
    setPriority('Medium');
    setError(null);
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!profile) {
      setError('Not signed in.');
      return;
    }
    if (!title.trim()) {
      setError('Give the task a title.');
      return;
    }
    if (!effectiveAssignDept) {
      setError('Pick a branch.');
      return;
    }
    const assignee = assigneeOptions.find((u) => u.uid === assigneeUid);
    if (!assignee) {
      setError('Pick who this task is for.');
      return;
    }
    setBusy(true);
    try {
      await assignTask({
        title: title.trim(),
        description: description.trim(),
        department: effectiveAssignDept,
        assigneeUid: assignee.uid,
        assigneeName: assignee.name,
        priority,
        createdByUid: profile.uid,
        createdByName: profile.name,
      });
      flash(`Assigned "${title.trim()}" to ${assignee.name}.`);
      resetForm();
      setFormOpen(false);
    } catch (err) {
      setError('Could not assign that task. Please try again.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkDone(task: StaffTask) {
    try {
      await markTaskDone(task.id);
      flash(`Marked "${task.title}" as done — waiting for your manager to confirm.`);
    } catch {
      flash('Could not update that task.');
    }
  }

  async function handleClose(task: StaffTask) {
    try {
      await closeTask(task.id, profile?.name || 'Unknown');
      flash(`Closed "${task.title}".`);
    } catch {
      flash('Could not close that task.');
    }
  }

  async function handleReopen(task: StaffTask) {
    try {
      await reopenTask(task.id);
      flash(`Reopened "${task.title}".`);
    } catch {
      flash('Could not reopen that task.');
    }
  }

  async function handleDelete(task: StaffTask) {
    if (!window.confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteTask(task.id);
      flash('Task deleted.');
    } catch {
      flash('Could not delete that task.');
    }
  }

  async function handlePriorityChange(task: StaffTask, next: TaskPriority) {
    if (next === task.priority) return;
    try {
      await updateTaskPriority(task.id, next);
    } catch {
      flash('Could not update priority.');
    }
  }

  async function handleAddProgressUpdate(task: StaffTask) {
    if (!profile || !progressDraft.trim()) return;
    setProgressBusy(true);
    try {
      await addProgressUpdate(task.id, { text: progressDraft.trim(), byUid: profile.uid, byName: profile.name });
      setProgressDraft('');
      flash('Progress update added.');
    } catch {
      flash('Could not add that update.');
    } finally {
      setProgressBusy(false);
    }
  }

  const rows = view === 'open' ? filteredOpenTasks : filteredCompletedTasks;
  // Task, Priority, Assigned Date, Close Date, Progress Update, Actions = 6 base columns,
  // plus Assignee (hidden for a staff account viewing only their own tasks) and Confirmed
  // (Completed view only).
  const colCount = 6 + (!isStaff ? 1 : 0) + (view === 'completed' ? 1 : 0);

  if (loading) {
    return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Task Board</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {canManage ? "Assign and track your Operation Staff's tasks." : 'Tasks assigned to you.'}
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => {
                resetForm();
                setFormOpen((v) => !v);
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              {formOpen ? 'Cancel' : '+ Assign Task'}
            </button>
          )}
        </div>

        <div className={clsx('grid gap-3 mt-4 max-w-3xl', isStaff ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
          <StatCard
            label="Open Tasks"
            value={String(openTasks.length)}
            sub={awaitingConfirmationCount > 0 ? `${awaitingConfirmationCount} awaiting your confirmation` : undefined}
            accent="#283278"
            action={{ label: 'Go to list', onClick: () => setView('open'), disabled: openTasks.length === 0 }}
          />
          <StatCard
            label="Completed Tasks"
            value={String(completedThisMonth.length)}
            sub="This month — resets every 1st"
            accent="#0f766e"
            action={{ label: 'Go to list', onClick: () => setView('completed'), disabled: completedThisMonth.length === 0 }}
          />
          {/* Operation Staff don't get a productivity readout on their own tasks — this is a
              management metric for whoever's assigning the work, not the person doing it. */}
          {!isStaff && (
            <StatCard
              label="Productivity"
              value={productivity === null ? '—' : `${productivity}%`}
              sub="Completed this month ÷ (completed + open)"
              accent="#00a3da"
            />
          )}
        </div>
      </header>

      <div className="px-6 py-6 max-w-5xl space-y-6">
        {toast && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {toast}
          </div>
        )}

        {canManage && formOpen && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800">Assign Task</h3>
            <form onSubmit={handleAssign} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                className="input sm:col-span-2"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details (optional)"
                rows={2}
                className="input sm:col-span-2"
              />
              {isAdmin ? (
                <select
                  value={assignDept}
                  onChange={(e) => {
                    setAssignDept(e.target.value);
                    setAssigneeUid('');
                  }}
                  className="input"
                >
                  <option value="">Select a branch…</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="input flex items-center bg-slate-50 text-slate-500">
                  {profile?.department || '—'} (your branch)
                </div>
              )}
              <select value={assigneeUid} onChange={(e) => setAssigneeUid(e.target.value)} className="input">
                <option value="">Select Operation Staff…</option>
                {assigneeOptions.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.name}
                  </option>
                ))}
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="input sm:col-span-2"
              >
                <option value="High">High priority</option>
                <option value="Medium">Medium priority</option>
                <option value="Low">Low priority</option>
              </select>
              {error && <p className="sm:col-span-2 text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="sm:col-span-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {busy ? 'Assigning…' : 'Assign Task'}
              </button>
            </form>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setView('open')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition',
                view === 'open' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Open ({filteredOpenTasks.length})
            </button>
            <button
              onClick={() => setView('completed')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition',
                view === 'completed' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              Completed this month ({filteredCompletedTasks.length})
            </button>
          </div>
          {/* A staff account only ever has itself as an assignee, so the filter would be a
              one-option no-op — skip it for them, same as the Assignee table column. */}
          {!isStaff && (
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="input text-sm sm:max-w-[180px]"
            >
              <option value={ALL_ASSIGNEES}>All assignees</option>
              {assigneeFilterOptions.map((a) => (
                <option key={a.uid} value={a.uid}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as 'all' | TaskPriority)}
            className="input text-sm sm:max-w-[160px]"
          >
            <option value="all">All priorities</option>
            <option value="High">High priority</option>
            <option value="Medium">Medium priority</option>
            <option value="Low">Low priority</option>
          </select>
          {isAdmin && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="input text-sm ml-auto sm:max-w-[200px]"
            >
              <option value={ALL_BRANCHES}>All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-4 font-medium">Task</th>
                  {!isStaff && <th className="py-2 pr-4 font-medium">Assignee</th>}
                  <th className="py-2 pr-4 font-medium">Priority</th>
                  <th className="py-2 pr-4 font-medium">Assigned Date</th>
                  <th className="py-2 pr-4 font-medium">Close Date</th>
                  <th className="py-2 pr-4 font-medium">Progress Update</th>
                  {view === 'completed' && <th className="py-2 pr-4 font-medium">Confirmed</th>}
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="border-b border-slate-50 last:border-0 align-top">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-800">{t.title}</p>
                        {t.description && <p className="text-xs text-slate-400 mt-0.5">{t.description}</p>}
                      </td>
                      {!isStaff && <td className="py-2.5 pr-4 text-slate-600">{t.assigneeName}</td>}
                      <td className="py-2.5 pr-4">
                        {canManage && t.status !== 'closed' ? (
                          <select
                            value={t.priority}
                            onChange={(e) => handlePriorityChange(t, e.target.value as TaskPriority)}
                            className={clsx(
                              'text-xs rounded-full px-2 py-1 border-0 font-medium',
                              priorityBadgeClass(t.priority)
                            )}
                          >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                        ) : (
                          <span className={clsx('text-xs rounded-full px-2 py-1 font-medium', priorityBadgeClass(t.priority))}>
                            {t.priority}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(t.createdAt)}</td>
                      <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                        {t.staffCompletedAt ? formatDateTime(t.staffCompletedAt) : '—'}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[180px]">
                        {t.progressUpdates.length > 0 ? (
                          <>
                            <p
                              className="text-xs text-slate-600 truncate"
                              title={t.progressUpdates[t.progressUpdates.length - 1].text}
                            >
                              {t.progressUpdates[t.progressUpdates.length - 1].text}
                            </p>
                            <button
                              onClick={() => {
                                setExpandedTaskId((cur) => (cur === t.id ? null : t.id));
                                setProgressDraft('');
                              }}
                              className="text-xs text-blue-600 hover:text-blue-700 mt-0.5"
                            >
                              {expandedTaskId === t.id ? 'Hide' : `View log (${t.progressUpdates.length})`}
                            </button>
                          </>
                        ) : t.status !== 'closed' ? (
                          <button
                            onClick={() => {
                              setExpandedTaskId((cur) => (cur === t.id ? null : t.id));
                              setProgressDraft('');
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            {expandedTaskId === t.id ? 'Hide' : 'Add update'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      {view === 'completed' && (
                        <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                          {t.closedAt ? formatDateTime(t.closedAt) : '—'}
                          {t.closedByName && <span className="block text-xs text-slate-400">by {t.closedByName}</span>}
                        </td>
                      )}
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          {isStaff && t.status === 'open' && (
                            <button
                              onClick={() => handleMarkDone(t)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              Mark as Done
                            </button>
                          )}
                          {isStaff && t.status === 'staffCompleted' && (
                            <span className="text-xs text-amber-600">Awaiting confirmation</span>
                          )}
                          {canManage && t.status === 'staffCompleted' && (
                            <>
                              <button
                                onClick={() => handleClose(t)}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                              >
                                Close Task
                              </button>
                              <button onClick={() => handleReopen(t)} className="text-xs text-slate-500 hover:text-amber-600">
                                Reopen
                              </button>
                            </>
                          )}
                          {canManage && (
                            <button onClick={() => handleDelete(t)} className="text-xs text-slate-400 hover:text-rose-600">
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedTaskId === t.id && (
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <td colSpan={colCount} className="px-4 py-3">
                          <div className="space-y-2 max-w-xl">
                            {t.progressUpdates.length > 0 && (
                              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                                {[...t.progressUpdates].reverse().map((u, i) => (
                                  <li key={i} className="text-xs text-slate-600 border-l-2 border-slate-200 pl-2">
                                    <span className="block text-slate-400">
                                      {formatDateTime(u.at)} · {u.byName}
                                    </span>
                                    {u.text}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {t.status !== 'closed' ? (
                              <div className="flex items-start gap-2">
                                <textarea
                                  value={progressDraft}
                                  onChange={(e) => setProgressDraft(e.target.value)}
                                  placeholder="Add a progress update…"
                                  rows={2}
                                  className="input flex-1 text-xs"
                                />
                                <button
                                  onClick={() => handleAddProgressUpdate(t)}
                                  disabled={progressBusy || !progressDraft.trim()}
                                  className="px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 shrink-0"
                                >
                                  Post
                                </button>
                              </div>
                            ) : (
                              t.progressUpdates.length === 0 && (
                                <p className="text-xs text-slate-400">No progress updates were logged on this task.</p>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="py-8 text-center text-sm text-slate-400">
                      {view === 'open' ? 'No open tasks.' : 'No tasks completed this month yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
