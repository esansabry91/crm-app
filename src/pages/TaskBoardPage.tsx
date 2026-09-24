import { Fragment, useMemo, useState, type FormEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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

// TaskPriority itself ('High'/'Medium'/'Low') stays the stored/data-model value — only its
// on-screen label is translated, matching the same convention as every other status/priority
// enum elsewhere in this app.
function priorityLabel(priority: TaskPriority, t: TFunction): string {
  switch (priority) {
    case 'High':
      return t('taskBoard.priorityHigh');
    case 'Medium':
      return t('taskBoard.priorityMedium');
    default:
      return t('taskBoard.priorityLow');
  }
}

export default function TaskBoardPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const { tasks, loading, error: loadError } = useTasks(profile);
  const { users } = useUsers(profile);
  const { branches } = useBranches();

  const isManager = profile?.role === 'branchManager';
  const isAdmin = isAdminRole(profile?.role);
  // Assign / set priority / close / reopen / delete — a Branch Manager (own branch, enforced
  // server-side by firestore.rules) or an admin-tier account (any branch).
  const canManage = isManager || isAdmin;
  const isStaff = profile?.role === 'dutyStaff' || profile?.role === 'operationAdmin';

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
        .filter(
          (u) =>
            (u.role === 'dutyStaff' || u.role === 'operationAdmin') &&
            u.active !== false &&
            u.department === effectiveAssignDept
        )
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
      setError(t('taskBoard.errorNotSignedIn'));
      return;
    }
    if (!title.trim()) {
      setError(t('taskBoard.errorGiveTitle'));
      return;
    }
    if (!effectiveAssignDept) {
      setError(t('taskBoard.errorPickBranch'));
      return;
    }
    const assignee = assigneeOptions.find((u) => u.uid === assigneeUid);
    if (!assignee) {
      setError(t('taskBoard.errorPickAssignee'));
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
      flash(t('taskBoard.toastAssigned', { title: title.trim(), name: assignee.name }));
      resetForm();
      setFormOpen(false);
    } catch (err) {
      setError(t('taskBoard.errorAssignFailed'));
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkDone(task: StaffTask) {
    try {
      await markTaskDone(task.id);
      flash(t('taskBoard.toastMarkedDone', { title: task.title }));
    } catch {
      flash(t('taskBoard.errorMarkDoneFailed'));
    }
  }

  async function handleClose(task: StaffTask) {
    try {
      await closeTask(task.id, profile?.name || t('taskBoard.unknownFallback'));
      flash(t('taskBoard.toastClosed', { title: task.title }));
    } catch {
      flash(t('taskBoard.errorCloseFailed'));
    }
  }

  async function handleReopen(task: StaffTask) {
    try {
      await reopenTask(task.id);
      flash(t('taskBoard.toastReopened', { title: task.title }));
    } catch {
      flash(t('taskBoard.errorReopenFailed'));
    }
  }

  async function handleDelete(task: StaffTask) {
    if (!window.confirm(t('taskBoard.confirmDelete', { title: task.title }))) return;
    try {
      await deleteTask(task.id);
      flash(t('taskBoard.toastDeleted'));
    } catch {
      flash(t('taskBoard.errorDeleteFailed'));
    }
  }

  async function handlePriorityChange(task: StaffTask, next: TaskPriority) {
    if (next === task.priority) return;
    try {
      await updateTaskPriority(task.id, next);
    } catch {
      flash(t('taskBoard.errorPriorityFailed'));
    }
  }

  async function handleAddProgressUpdate(task: StaffTask) {
    if (!profile || !progressDraft.trim()) return;
    setProgressBusy(true);
    try {
      await addProgressUpdate(task.id, { text: progressDraft.trim(), byUid: profile.uid, byName: profile.name });
      setProgressDraft('');
      flash(t('taskBoard.toastProgressAdded'));
    } catch {
      flash(t('taskBoard.errorProgressFailed'));
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
    return <div className="p-6 text-sm text-slate-400">{t('taskBoard.loadingEllipsis')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-6 py-5 border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t('nav.links.taskBoard')}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {canManage ? t('taskBoard.subtitleManage') : t('taskBoard.subtitleStaff')}
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
              {formOpen ? t('taskBoard.cancel') : t('taskBoard.assignTaskButton')}
            </button>
          )}
        </div>

        <div className={clsx('grid gap-3 mt-4 max-w-3xl', isStaff ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
          <StatCard
            label={t('taskBoard.openTasksLabel')}
            value={String(openTasks.length)}
            sub={awaitingConfirmationCount > 0 ? t('taskBoard.awaitingConfirmationSub', { count: awaitingConfirmationCount }) : undefined}
            accent="#283278"
            action={{ label: t('taskBoard.goToList'), onClick: () => setView('open'), disabled: openTasks.length === 0 }}
          />
          <StatCard
            label={t('taskBoard.completedTasksLabel')}
            value={String(completedThisMonth.length)}
            sub={t('taskBoard.completedSub')}
            accent="#0f766e"
            action={{ label: t('taskBoard.goToList'), onClick: () => setView('completed'), disabled: completedThisMonth.length === 0 }}
          />
          {/* Operation Staff don't get a productivity readout on their own tasks — this is a
              management metric for whoever's assigning the work, not the person doing it. */}
          {!isStaff && (
            <StatCard
              label={t('taskBoard.productivityLabel')}
              value={productivity === null ? '—' : `${productivity}%`}
              sub={t('taskBoard.productivitySub')}
              accent="#00a3da"
            />
          )}
        </div>
      </header>

      <div className="px-6 py-6 max-w-5xl space-y-6">
        {/* Surfaces useTasks()'s subscription error instead of just silently showing "no open
            tasks" — see useTasks.ts's doc comment on `error` for the incident (tasks/history
            going blank after a refresh with nothing in the UI to explain why) this exists to
            make diagnosable. */}
        {loadError && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {t('taskBoard.loadErrorBanner', { error: loadError })}
          </div>
        )}

        {toast && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            {toast}
          </div>
        )}

        {canManage && formOpen && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-800">{t('taskBoard.assignTaskFormTitle')}</h3>
            <form onSubmit={handleAssign} className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('taskBoard.taskTitlePlaceholder')}
                className="input sm:col-span-2"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('taskBoard.detailsPlaceholder')}
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
                  <option value="">{t('taskBoard.selectBranchPlaceholder')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="input flex items-center bg-slate-50 text-slate-500">
                  {t('taskBoard.yourBranch', { branch: profile?.department || '—' })}
                </div>
              )}
              <select value={assigneeUid} onChange={(e) => setAssigneeUid(e.target.value)} className="input">
                <option value="">{t('taskBoard.selectStaffPlaceholder')}</option>
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
                <option value="High">{t('taskBoard.priorityHighFull')}</option>
                <option value="Medium">{t('taskBoard.priorityMediumFull')}</option>
                <option value="Low">{t('taskBoard.priorityLowFull')}</option>
              </select>
              {error && <p className="sm:col-span-2 text-sm text-rose-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="sm:col-span-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
              >
                {busy ? t('taskBoard.assigningEllipsis') : t('taskBoard.assignTaskFormTitle')}
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
              {t('taskBoard.openTab', { count: filteredOpenTasks.length })}
            </button>
            <button
              onClick={() => setView('completed')}
              className={clsx(
                'px-3 py-1.5 text-sm font-medium rounded-md transition',
                view === 'completed' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {t('taskBoard.completedTab', { count: filteredCompletedTasks.length })}
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
              <option value={ALL_ASSIGNEES}>{t('taskBoard.allAssignees')}</option>
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
            <option value="all">{t('taskBoard.allPriorities')}</option>
            <option value="High">{t('taskBoard.priorityHighFull')}</option>
            <option value="Medium">{t('taskBoard.priorityMediumFull')}</option>
            <option value="Low">{t('taskBoard.priorityLowFull')}</option>
          </select>
          {isAdmin && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="input text-sm ml-auto sm:max-w-[200px]"
            >
              <option value={ALL_BRANCHES}>{t('taskBoard.allBranches')}</option>
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
                  <th className="py-2 pr-4 font-medium">{t('taskBoard.colTask')}</th>
                  {!isStaff && <th className="py-2 pr-4 font-medium">{t('taskBoard.colAssignee')}</th>}
                  <th className="py-2 pr-4 font-medium">{t('taskBoard.colPriority')}</th>
                  <th className="py-2 pr-4 font-medium">{t('taskBoard.colAssignedDate')}</th>
                  <th className="py-2 pr-4 font-medium">{t('taskBoard.colCloseDate')}</th>
                  <th className="py-2 pr-4 font-medium">{t('taskBoard.colProgressUpdate')}</th>
                  {view === 'completed' && <th className="py-2 pr-4 font-medium">{t('taskBoard.colConfirmed')}</th>}
                  <th className="py-2 font-medium text-right">{t('taskBoard.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((task) => (
                  <Fragment key={task.id}>
                    <tr className="border-b border-slate-50 last:border-0 align-top">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-slate-800">{task.title}</p>
                        {task.description && <p className="text-xs text-slate-400 mt-0.5">{task.description}</p>}
                      </td>
                      {!isStaff && <td className="py-2.5 pr-4 text-slate-600">{task.assigneeName}</td>}
                      <td className="py-2.5 pr-4">
                        {canManage && task.status !== 'closed' ? (
                          <select
                            value={task.priority}
                            onChange={(e) => handlePriorityChange(task, e.target.value as TaskPriority)}
                            className={clsx(
                              'text-xs rounded-full px-2 py-1 border-0 font-medium',
                              priorityBadgeClass(task.priority)
                            )}
                          >
                            <option value="High">{t('taskBoard.priorityHigh')}</option>
                            <option value="Medium">{t('taskBoard.priorityMedium')}</option>
                            <option value="Low">{t('taskBoard.priorityLow')}</option>
                          </select>
                        ) : (
                          <span className={clsx('text-xs rounded-full px-2 py-1 font-medium', priorityBadgeClass(task.priority))}>
                            {priorityLabel(task.priority, t)}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">{formatDateTime(task.createdAt)}</td>
                      <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                        {task.staffCompletedAt ? formatDateTime(task.staffCompletedAt) : '—'}
                      </td>
                      <td className="py-2.5 pr-4 max-w-[180px]">
                        {task.progressUpdates.length > 0 ? (
                          <>
                            <p
                              className="text-xs text-slate-600 truncate"
                              title={task.progressUpdates[task.progressUpdates.length - 1].text}
                            >
                              {task.progressUpdates[task.progressUpdates.length - 1].text}
                            </p>
                            <button
                              onClick={() => {
                                setExpandedTaskId((cur) => (cur === task.id ? null : task.id));
                                setProgressDraft('');
                              }}
                              className="text-xs text-blue-600 hover:text-blue-700 mt-0.5"
                            >
                              {expandedTaskId === task.id ? t('taskBoard.hide') : t('taskBoard.viewLog', { count: task.progressUpdates.length })}
                            </button>
                          </>
                        ) : task.status !== 'closed' ? (
                          <button
                            onClick={() => {
                              setExpandedTaskId((cur) => (cur === task.id ? null : task.id));
                              setProgressDraft('');
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            {expandedTaskId === task.id ? t('taskBoard.hide') : t('taskBoard.addUpdate')}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      {view === 'completed' && (
                        <td className="py-2.5 pr-4 text-slate-500 whitespace-nowrap">
                          {task.closedAt ? formatDateTime(task.closedAt) : '—'}
                          {task.closedByName && <span className="block text-xs text-slate-400">{t('taskBoard.byName', { name: task.closedByName })}</span>}
                        </td>
                      )}
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          {isStaff && task.status === 'open' && (
                            <button
                              onClick={() => handleMarkDone(task)}
                              className="text-xs font-medium text-blue-600 hover:text-blue-700"
                            >
                              {t('taskBoard.markAsDone')}
                            </button>
                          )}
                          {isStaff && task.status === 'staffCompleted' && (
                            <span className="text-xs text-amber-600">{t('taskBoard.awaitingConfirmationBadge')}</span>
                          )}
                          {canManage && task.status === 'staffCompleted' && (
                            <>
                              <button
                                onClick={() => handleClose(task)}
                                className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                              >
                                {t('taskBoard.closeTaskButton')}
                              </button>
                              <button onClick={() => handleReopen(task)} className="text-xs text-slate-500 hover:text-amber-600">
                                {t('taskBoard.reopenButton')}
                              </button>
                            </>
                          )}
                          {canManage && (
                            <button onClick={() => handleDelete(task)} className="text-xs text-slate-400 hover:text-rose-600">
                              {t('taskBoard.deleteButton')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedTaskId === task.id && (
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <td colSpan={colCount} className="px-4 py-3">
                          <div className="space-y-2 max-w-xl">
                            {task.progressUpdates.length > 0 && (
                              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                                {[...task.progressUpdates].reverse().map((u, i) => (
                                  <li key={i} className="text-xs text-slate-600 border-l-2 border-slate-200 pl-2">
                                    <span className="block text-slate-400">
                                      {formatDateTime(u.at)} · {u.byName}
                                    </span>
                                    {u.text}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {task.status !== 'closed' ? (
                              <div className="flex items-start gap-2">
                                <textarea
                                  value={progressDraft}
                                  onChange={(e) => setProgressDraft(e.target.value)}
                                  placeholder={t('taskBoard.addProgressUpdatePlaceholder')}
                                  rows={2}
                                  className="input flex-1 text-xs"
                                />
                                <button
                                  onClick={() => handleAddProgressUpdate(task)}
                                  disabled={progressBusy || !progressDraft.trim()}
                                  className="px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 shrink-0"
                                >
                                  {t('taskBoard.postButton')}
                                </button>
                              </div>
                            ) : (
                              task.progressUpdates.length === 0 && (
                                <p className="text-xs text-slate-400">{t('taskBoard.noProgressUpdates')}</p>
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
                      {view === 'open' ? t('taskBoard.noOpenTasks') : t('taskBoard.noCompletedTasks')}
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
