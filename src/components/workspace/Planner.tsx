/**
 * Weekly Planner — ported from gdsb-portal's apps/web/src/pages/workspace/Planner.tsx: a
 * Monday-starting week grid of each day's tasks and meetings, the same priority-lock rule Today
 * Tasks uses (today locked once reviewed, tomorrow always open, every other day fixed), and
 * meeting scheduling (via MeetingDialog). Laid out as stacked day sections rather than gdsb-
 * portal's side-scrolling 7-column grid — same data and rules, a simpler, reliably-buildable
 * layout for crm-app's own component conventions.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import {
  addWorkspaceTask,
  deleteWorkspaceTask,
  renameWorkspaceTask,
  subscribeMyWorkspaceTasks,
  subscribeWorkspaceDay,
  toggleWorkspaceTaskDone,
  updateWorkspaceTaskPriority,
} from '../../services/workspace';
import { subscribeMyWorkspaceMeetings } from '../../services/workspaceMeetings';
import { workspaceTaskPriorityLocked, type WorkspaceMeeting, type WorkspaceTask } from '../../types';
import { addDays, dayLabel, formatDateDisplay, mondayOf, todayIso, tomorrowIso, weekDates, weekRangeLabel } from '../../utils/workspaceDates';
import PriorityLights, { sortWorkspaceTasks } from './PriorityLights';
import MeetingDialog from './MeetingDialog';

function ModeIcon({ mode }: { mode: WorkspaceMeeting['mode'] }) {
  if (mode === 'online') return <span aria-hidden>🔗</span>;
  if (mode === 'physical') return <span aria-hidden>📍</span>;
  return null;
}

function DayColumn({
  date,
  tasks,
  meetings,
  locked,
  myUid,
  onAdd,
  onToggle,
  onRename,
  onPriority,
  onDelete,
  onAddMeeting,
  onOpenMeeting,
}: {
  date: string;
  tasks: WorkspaceTask[];
  meetings: WorkspaceMeeting[];
  locked: boolean;
  myUid: string;
  onAdd: (title: string) => void;
  onToggle: (task: WorkspaceTask) => void;
  onRename: (task: WorkspaceTask, title: string) => void;
  onPriority: (task: WorkspaceTask, priority: WorkspaceTask['priority']) => void;
  onDelete: (task: WorkspaceTask) => void;
  onAddMeeting: () => void;
  onOpenMeeting: (meeting: WorkspaceMeeting) => void;
}) {
  const [draft, setDraft] = useState('');
  const isToday = date === todayIso();

  return (
    <div className={clsx('bg-white rounded-xl border p-3', isToday ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200')}>
      <div className="flex items-center justify-between mb-2">
        <p className={clsx('text-sm font-semibold', isToday ? 'text-blue-700' : 'text-slate-800')}>{dayLabel(date)}</p>
        <span className="text-xs text-slate-400">{formatDateDisplay(date)}</span>
      </div>

      <div className="space-y-1.5">
        {sortWorkspaceTasks(tasks).map((task) => (
          <div key={task.id} className="flex items-center gap-2 group">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => onToggle(task)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 shrink-0"
            />
            <input
              defaultValue={task.title}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== task.title) onRename(task, v);
                else e.target.value = task.title;
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className={clsx('flex-1 min-w-0 text-xs bg-transparent border-none focus:ring-0 px-0', task.done ? 'text-slate-400 line-through' : 'text-slate-700')}
            />
            <PriorityLights value={task.priority} editable={!locked} onChange={(p) => onPriority(task, p)} compact />
            <button type="button" onClick={() => onDelete(task)} className="text-slate-300 hover:text-rose-600 text-xs opacity-0 group-hover:opacity-100 shrink-0">
              ✕
            </button>
          </div>
        ))}
        {tasks.length === 0 && <p className="text-xs text-slate-300">No tasks</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onAdd(draft.trim());
          setDraft('');
        }}
        className="mt-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+ Add task"
          className="w-full text-xs bg-slate-50 rounded-md px-2 py-1 border border-transparent focus:border-slate-300 focus:outline-none"
        />
      </form>

      {meetings.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1.5">
          {meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenMeeting(m)}
              className="w-full flex items-center gap-1.5 text-xs text-left bg-violet-50 hover:bg-violet-100 rounded-md px-2 py-1"
            >
              <span className="text-violet-700 shrink-0">{m.startTime || 'All day'}</span>
              <ModeIcon mode={m.mode} />
              <span className="truncate text-violet-900">{m.title}</span>
              {m.organizerUid !== myUid && m.attendees[myUid]?.status === 'invited' && (
                <span className="ml-auto text-[10px] text-violet-500 shrink-0">invited</span>
              )}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={onAddMeeting} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700">
        + Schedule meeting
      </button>
    </div>
  );
}

export default function Planner() {
  const { profile } = useAuth();
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [meetings, setMeetings] = useState<WorkspaceMeeting[]>([]);
  const [reviewedToday, setReviewedToday] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ date: string } | { meeting: WorkspaceMeeting } | null>(null);

  const today = todayIso();
  const tomorrow = tomorrowIso();

  useEffect(() => {
    if (!profile) return;
    const unsubTasks = subscribeMyWorkspaceTasks(profile.uid, setTasks);
    const unsubMeetings = subscribeMyWorkspaceMeetings(profile.uid, setMeetings);
    const unsubDay = subscribeWorkspaceDay(profile.uid, today, (day) => setReviewedToday(!!day?.prioritiesReviewedAt));
    return () => {
      unsubTasks();
      unsubMeetings();
      unsubDay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid]);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const tasksByDate = useMemo(() => {
    const map = new Map<string, WorkspaceTask[]>();
    for (const t of tasks) {
      if (!dates.includes(t.date)) continue;
      map.set(t.date, [...(map.get(t.date) ?? []), t]);
    }
    return map;
  }, [tasks, dates]);
  const meetingsByDate = useMemo(() => {
    const map = new Map<string, WorkspaceMeeting[]>();
    for (const m of meetings) {
      if (!dates.includes(m.date)) continue;
      map.set(m.date, [...(map.get(m.date) ?? []), m].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
    }
    return map;
  }, [meetings, dates]);

  async function handlePriority(task: WorkspaceTask, priority: WorkspaceTask['priority']) {
    try {
      await updateWorkspaceTaskPriority(task, priority, reviewedToday);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority.');
    }
  }

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{weekRangeLabel(weekStart)}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setWeekStart((w) => addDays(w, -7))} className="px-2.5 py-1 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">
            ← Prev
          </button>
          <button type="button" onClick={() => setWeekStart(mondayOf(todayIso()))} className="px-2.5 py-1 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">
            This week
          </button>
          <button type="button" onClick={() => setWeekStart((w) => addDays(w, 7))} className="px-2.5 py-1 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">
            Next →
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {dates.map((date) => (
          <DayColumn
            key={date}
            date={date}
            tasks={tasksByDate.get(date) ?? []}
            meetings={meetingsByDate.get(date) ?? []}
            locked={workspaceTaskPriorityLocked(date, today, tomorrow, reviewedToday)}
            myUid={profile.uid}
            onAdd={(title) => void addWorkspaceTask({ uid: profile.uid, date, title, existingOnDate: tasksByDate.get(date) ?? [] })}
            onToggle={(task) => void toggleWorkspaceTaskDone(task.id, !task.done)}
            onRename={(task, title) => void renameWorkspaceTask(task.id, title)}
            onPriority={handlePriority}
            onDelete={(task) => void deleteWorkspaceTask(task.id)}
            onAddMeeting={() => setDialog({ date })}
            onOpenMeeting={(meeting) => setDialog({ meeting })}
          />
        ))}
      </div>

      {dialog && (
        <MeetingDialog
          date={'date' in dialog ? dialog.date : dialog.meeting.date}
          meeting={'meeting' in dialog ? dialog.meeting : null}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
