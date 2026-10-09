/**
 * Today Tasks — ported from gdsb-portal's apps/web/src/pages/workspace/TodayTasks.tsx: the
 * priority-confirmation banner/lock rule, a progress bar, a carried-over-from-earlier-days
 * section, today's meetings panel, and the Celebration trigger when the last open task is ticked
 * off. Self-contained (own Firestore subscriptions), mirroring how EmployeeFeedbackPage.tsx
 * subscribes directly rather than through a shared hook.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeMyWorkspaceTasks, subscribeWorkspaceDay, addWorkspaceTask, confirmTodayPriorities, deleteWorkspaceTask, moveWorkspaceTaskToDate, renameWorkspaceTask, toggleWorkspaceTaskDone, updateWorkspaceTaskPriority } from '../../services/workspace';
import { subscribeMyWorkspaceMeetings } from '../../services/workspaceMeetings';
import { workspaceTaskPriorityLocked, type WorkspaceMeeting, type WorkspaceTask } from '../../types';
import { dayLabel, formatDateDisplay, todayIso, tomorrowIso, weekdayIndex } from '../../utils/workspaceDates';
import PriorityLights, { priorityBand, sortWorkspaceTasks } from './PriorityLights';
import { Celebration } from './Celebration';

function ModeIcon({ mode }: { mode: WorkspaceMeeting['mode'] }) {
  if (mode === 'online') return <span aria-hidden>🔗</span>;
  if (mode === 'physical') return <span aria-hidden>📍</span>;
  return null;
}

function TaskRow({
  task,
  locked,
  onToggle,
  onRename,
  onPriority,
  onDelete,
  trailing,
}: {
  task: WorkspaceTask;
  locked: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onPriority: (p: WorkspaceTask['priority']) => void;
  onDelete: () => void;
  trailing?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  return (
    <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-3 py-2.5">
      <input type="checkbox" checked={task.done} onChange={onToggle} className="h-4 w-4 rounded border-slate-300 text-blue-600 shrink-0" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft.trim() && draft.trim() !== task.title) onRename(draft.trim());
            else setDraft(task.title);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="input flex-1 min-w-0 py-1"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={clsx('flex-1 min-w-0 text-left text-sm truncate', task.done ? 'text-slate-400 line-through' : 'text-slate-800')}
        >
          {task.title}
        </button>
      )}
      <PriorityLights value={task.priority} editable={!locked} onChange={onPriority} title={`Priority: ${priorityBand(task.priority)}`} />
      {trailing}
      <button type="button" onClick={onDelete} aria-label="Delete task" className="text-slate-300 hover:text-rose-600 text-sm shrink-0">
        ✕
      </button>
    </div>
  );
}

export default function TodayTasks() {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [reviewedAt, setReviewedAt] = useState<number | null>(null);
  const [meetings, setMeetings] = useState<WorkspaceMeeting[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayIso();
  const tomorrow = tomorrowIso();

  useEffect(() => {
    if (!profile) return;
    const unsub = subscribeMyWorkspaceTasks(profile.uid, setTasks);
    const unsubDay = subscribeWorkspaceDay(profile.uid, today, (day) => setReviewedAt(day?.prioritiesReviewedAt ?? null));
    const unsubMeetings = subscribeMyWorkspaceMeetings(profile.uid, setMeetings);
    return () => {
      unsub();
      unsubDay();
      unsubMeetings();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  const todayTasks = useMemo(() => sortWorkspaceTasks(tasks.filter((t) => t.date === today)), [tasks, today]);
  const carriedOver = useMemo(
    () => tasks.filter((t) => t.date < today && !t.done).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [tasks, today]
  );
  const todayMeetings = useMemo(() => meetings.filter((m) => m.date === today), [meetings, today]);
  const reviewed = !!reviewedAt;
  const doneCount = todayTasks.filter((t) => t.done).length;
  const progress = todayTasks.length ? Math.round((doneCount / todayTasks.length) * 100) : 0;

  async function handleAdd() {
    if (!profile || !newTitle.trim()) return;
    await addWorkspaceTask({ uid: profile.uid, date: today, title: newTitle.trim(), existingOnDate: todayTasks });
    setNewTitle('');
  }

  async function handleToggle(task: WorkspaceTask) {
    const nextDone = !task.done;
    await toggleWorkspaceTaskDone(task.id, nextDone);
    if (nextDone) {
      const remainingOpen = todayTasks.filter((t) => t.id !== task.id && !t.done).length;
      if (remainingOpen === 0 && todayTasks.length > 0) setCelebrate(true);
    }
  }

  async function handlePriority(task: WorkspaceTask, priority: WorkspaceTask['priority']) {
    try {
      await updateWorkspaceTaskPriority(task, priority, reviewed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority.');
    }
  }

  if (!profile) return null;

  return (
    <div className="space-y-5">
      {celebrate && (
        <Celebration weekday={weekdayIndex(today)} dayLabel={dayLabel(today)} taskCount={todayTasks.length} onClose={() => setCelebrate(false)} />
      )}

      {todayTasks.length > 0 && (
        <div className={clsx('rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap', reviewed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
          <div>
            <p className={clsx('text-sm font-medium', reviewed ? 'text-emerald-800' : 'text-amber-800')}>
              {reviewed ? 'Priorities reviewed for today.' : "Review today's priorities before you start."}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {reviewed ? "They're locked in for the rest of today." : 'Once confirmed, today’s priorities lock for the day.'}
            </p>
          </div>
          {!reviewed && (
            <button
              type="button"
              onClick={() => confirmTodayPriorities(profile.uid, today)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shrink-0"
            >
              Confirm priorities
            </button>
          )}
        </div>
      )}

      {todayTasks.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>
              {doneCount} / {todayTasks.length} done
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {todayMeetings.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Today’s meetings</h3>
          <div className="space-y-2">
            {todayMeetings.map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-sm">
                <span className="text-slate-400 w-16 shrink-0">{m.startTime || 'All day'}</span>
                <ModeIcon mode={m.mode} />
                <span className="text-slate-800 truncate">{m.title}</span>
                {m.organizerUid !== profile.uid && <span className="text-xs text-slate-400 shrink-0">with {m.organizerName}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {todayTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            locked={workspaceTaskPriorityLocked(task.date, today, tomorrow, reviewed)}
            onToggle={() => handleToggle(task)}
            onRename={(title) => renameWorkspaceTask(task.id, title)}
            onPriority={(p) => handlePriority(task, p)}
            onDelete={() => deleteWorkspaceTask(task.id)}
          />
        ))}
        {todayTasks.length === 0 && <p className="text-sm text-slate-400">Nothing planned for today yet.</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
          className="flex gap-2"
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task for today…"
            className="input flex-1"
          />
          <button type="submit" className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shrink-0">
            Add
          </button>
        </form>
      </div>

      {carriedOver.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Carried over from earlier</h3>
          <div className="space-y-2">
            {carriedOver.map((task) => (
              <div key={task.id} className="flex items-center gap-3 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2.5">
                <input type="checkbox" checked={task.done} onChange={() => handleToggle(task)} className="h-4 w-4 rounded border-slate-300 text-blue-600 shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{task.title}</span>
                <span className="text-xs text-slate-400 shrink-0">{formatDateDisplay(task.date)}</span>
                <button
                  type="button"
                  onClick={() => moveWorkspaceTaskToDate(task.id, today, todayTasks)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"
                >
                  Move to today
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
