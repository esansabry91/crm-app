/**
 * Today Tasks — ported from gdsb-portal's apps/web/src/pages/workspace/TodayTasks.tsx: the
 * priority-confirmation banner/lock rule, a progress bar, a carried-over-from-earlier-days
 * section, today's meetings panel, and the Celebration trigger when the last open task is ticked
 * off. Self-contained (own Firestore subscriptions), mirroring how EmployeeFeedbackPage.tsx
 * subscribes directly rather than through a shared hook.
 *
 * Laid out as a two-column orientation (a big date-heading task card alongside a side "Today's
 * meetings" panel) matching gdsb-portal's own Today Tasks screen, with a static priority-color
 * legend next to the heading instead of repeating it on every row.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeMyWorkspaceTasks, subscribeWorkspaceDay, addWorkspaceTask, confirmTodayPriorities, deleteWorkspaceTask, moveWorkspaceTaskToDate, renameWorkspaceTask, toggleWorkspaceTaskDone, updateWorkspaceTaskPriority } from '../../services/workspace';
import { subscribeMyWorkspaceMeetings } from '../../services/workspaceMeetings';
import { workspaceTaskPriorityLocked, type WorkspaceMeeting, type WorkspaceTask } from '../../types';
import { formatDateDisplay, fullDayLabel, dayLabel, todayIso, tomorrowIso, weekdayIndex } from '../../utils/workspaceDates';
import PriorityLights, { BAND_COLOR, priorityBand, sortWorkspaceTasks } from './PriorityLights';
import { Celebration } from './Celebration';
import MeetingDialog from './MeetingDialog';

function ModeIcon({ mode }: { mode: WorkspaceMeeting['mode'] }) {
  if (mode === 'online') return <span aria-hidden>🔗</span>;
  if (mode === 'physical') return <span aria-hidden>📍</span>;
  return null;
}

/** Static red/amber/blue key next to the date heading — explains what the per-task priority dots
 *  mean without repeating a legend on every single row. */
function PriorityLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
      {(['high', 'medium', 'low'] as const).map((band) => (
        <span key={band} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: BAND_COLOR[band] }} />
          {band === 'high' ? 'High' : band === 'medium' ? 'Medium' : 'Low'}
        </span>
      ))}
    </div>
  );
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
  const [dialog, setDialog] = useState<{ date: string } | { meeting: WorkspaceMeeting } | null>(null);

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

      {dialog && (
        <MeetingDialog
          date={'date' in dialog ? dialog.date : dialog.meeting.date}
          meeting={'meeting' in dialog ? dialog.meeting : null}
          onClose={() => setDialog(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Main column — date heading, legend, progress, today's tasks, carried-over box */}
        <div className="space-y-4 min-w-0">
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Today</p>
                <h2 className="text-2xl font-semibold text-slate-900 mt-0.5">{fullDayLabel(today)}</h2>
              </div>
              <PriorityLegend />
            </div>

            {todayTasks.length > 0 && (
              <div className={clsx('rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap mt-4', reviewed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200')}>
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
              <div className="mt-4">
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

            <div className="space-y-2 mt-4">
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
          </div>

          {carriedOver.length > 0 && (
            <div className="bg-amber-50/60 rounded-2xl border border-amber-100 p-4">
              <h3 className="text-sm font-semibold text-amber-800 mb-2">Still open from earlier this week</h3>
              <div className="space-y-2">
                {carriedOver.map((task) => (
                  <div key={task.id} className="flex items-center gap-3 bg-white rounded-xl border border-amber-100 px-3 py-2.5">
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

        {/* Side column — today's meetings */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 lg:sticky lg:top-20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-800">Today’s meetings</h3>
            <button type="button" onClick={() => setDialog({ date: today })} className="text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0">
              + Meeting
            </button>
          </div>
          <div className="space-y-2">
            {todayMeetings.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setDialog({ meeting: m })}
                className="w-full text-left border-l-[3px] border-violet-500 bg-violet-50 hover:bg-violet-100 rounded-r-lg pl-3 pr-3 py-2"
              >
                <p className="text-xs font-medium text-violet-600">{m.startTime || 'All day'}</p>
                <p className="text-sm text-violet-900 truncate flex items-center gap-1 mt-0.5">
                  <ModeIcon mode={m.mode} />
                  {m.title}
                </p>
                {m.organizerUid !== profile.uid && <p className="text-[11px] text-violet-500 mt-0.5">with {m.organizerName}</p>}
              </button>
            ))}
            {todayMeetings.length === 0 && <p className="text-xs text-slate-400">No meetings today.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
