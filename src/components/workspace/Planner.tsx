/**
 * Weekly Planner — ported from gdsb-portal's apps/web/src/pages/workspace/Planner.tsx: a
 * Monday-starting week grid of each day's tasks and meetings, the same priority-lock rule Today
 * Tasks uses (today locked once reviewed, tomorrow always open, every other day fixed), and
 * meeting scheduling (via MeetingDialog).
 *
 * Laid out as a fixed-width, horizontally-scrolling day strip — matching gdsb-portal's own
 * side-scrolling 7-column Weekly planner, not a grid that wraps/squeezes at wider breakpoints
 * (squeezing a 7th column that tight is what truncated day labels and pushed status pills past
 * the page edge before this). A header carries week navigation, a done/meeting-count summary for
 * the visible week, and a header-level "+ Meeting" action; each day column carries a PAST / TODAY
 * / TOMORROW · SET PRIORITIES / WEEKEND status pill on its own line and a background to match —
 * today blue, tomorrow amber, any past day a light grey (weekend or not — past wins outright),
 * and every other weekend day (Saturday/Sunday) its own orange tint when it's neither past,
 * today, nor tomorrow — a background rule of its own, independent of the past-day rule, per how
 * this was asked for.
 */
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAuth } from '../../contexts/AuthContext';
import {
  addWorkspaceTask,
  deleteWorkspaceTask,
  moveWorkspaceTaskToDate,
  renameWorkspaceTask,
  subscribeMyWorkspaceTasks,
  subscribeWorkspaceDay,
  toggleWorkspaceTaskDone,
  updateWorkspaceTaskPriority,
} from '../../services/workspace';
import { subscribeMyWorkspaceMeetings } from '../../services/workspaceMeetings';
import { workspaceTaskPriorityLocked, type WorkspaceMeeting, type WorkspaceTask, type WorkspaceTaskPriority } from '../../types';
import { addDays, dayLabel, formatDateDisplay, mondayOf, todayIso, tomorrowIso, weekDates, weekRangeLabel, weekdayIndex } from '../../utils/workspaceDates';
import { BAND_COLOR, priorityBand, sortWorkspaceTasks } from './PriorityLights';
import MeetingDialog from './MeetingDialog';

function ModeIcon({ mode }: { mode: WorkspaceMeeting['mode'] }) {
  if (mode === 'online') return <span aria-hidden>🔗</span>;
  if (mode === 'physical') return <span aria-hidden>📍</span>;
  return null;
}

interface DayStatus {
  label: string;
  pillClass: string;
}

/** PAST beats WEEKEND (once a day is past, it reads as past — grey — whether or not it was also
 *  a weekend), but TODAY/TOMORROW beat both — those two carry priority-lock consequences a plain
 *  past/weekend label doesn't. */
function statusFor(date: string, today: string, tomorrow: string): DayStatus | null {
  if (date === today) return { label: 'TODAY', pillClass: 'bg-blue-600 text-white' };
  if (date === tomorrow) return { label: 'TOMORROW · SET PRIORITIES', pillClass: 'bg-amber-500 text-white' };
  if (date < today) return { label: 'PAST', pillClass: 'bg-slate-400 text-white' };
  if (weekdayIndex(date) >= 5) return { label: 'WEEKEND', pillClass: 'bg-orange-500 text-white' };
  return null;
}

/** The day-card background — today blue, tomorrow amber, any past day a light grey (regardless of
 *  weekend — past wins outright, no darker/blended variant), and every other weekend day
 *  (Saturday/Sunday) that ISN'T past/today/tomorrow its own orange tint. */
function cardClassFor(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'bg-blue-50/70 border-blue-300 ring-1 ring-blue-100';
  if (date === tomorrow) return 'bg-amber-50/70 border-amber-200';
  if (date < today) return 'bg-slate-100 border-slate-200';
  if (weekdayIndex(date) >= 5) return 'bg-orange-50 border-orange-200';
  return 'bg-white border-slate-200';
}

/** A single compact dot standing in for the 5-light picker used on Today Tasks — tap to cycle
 *  low → medium → high when editable, read-only (just colored) otherwise. Keeps the weekly grid's
 *  rows compact the way gdsb-portal's own planner keeps them. */
function PriorityDot({ priority, editable, onChange }: { priority: WorkspaceTaskPriority; editable: boolean; onChange: (p: WorkspaceTaskPriority) => void }) {
  const band = priorityBand(priority);
  function cycle() {
    if (!editable) return;
    onChange((band === 'low' ? 3 : band === 'medium' ? 5 : 1) as WorkspaceTaskPriority);
  }
  return (
    <button
      type="button"
      onClick={cycle}
      disabled={!editable}
      title={`Priority: ${band}`}
      className={clsx('w-2 h-2 rounded-full shrink-0', editable && 'cursor-pointer')}
      style={{ backgroundColor: BAND_COLOR[band] }}
    />
  );
}

function DayColumn({
  date,
  tasks,
  meetings,
  locked,
  myUid,
  today,
  tomorrow,
  onAdd,
  onToggle,
  onRename,
  onPriority,
  onDelete,
  onMoveNext,
  onOpenMeeting,
}: {
  date: string;
  tasks: WorkspaceTask[];
  meetings: WorkspaceMeeting[];
  locked: boolean;
  myUid: string;
  today: string;
  tomorrow: string;
  onAdd: (title: string) => void;
  onToggle: (task: WorkspaceTask) => void;
  onRename: (task: WorkspaceTask, title: string) => void;
  onPriority: (task: WorkspaceTask, priority: WorkspaceTask['priority']) => void;
  onDelete: (task: WorkspaceTask) => void;
  onMoveNext: (task: WorkspaceTask) => void;
  onOpenMeeting: (meeting: WorkspaceMeeting) => void;
}) {
  const [draft, setDraft] = useState('');
  const isToday = date === today;
  const status = statusFor(date, today, tomorrow);

  return (
    <div className={clsx('rounded-xl border p-3 h-full', cardClassFor(date, today, tomorrow))}>
      <div className="flex items-center justify-between gap-2">
        <p className={clsx('text-sm font-semibold', isToday ? 'text-blue-700' : 'text-slate-800')}>{dayLabel(date)}</p>
        <span className="text-xs text-slate-400 shrink-0">{formatDateDisplay(date)}</span>
      </div>
      {status && (
        <span className={clsx('inline-block mt-1.5 mb-1.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full tracking-wide', status.pillClass)}>
          {status.label}
        </span>
      )}

      <div className="space-y-1.5">
        {sortWorkspaceTasks(tasks).map((task) => (
          <div key={task.id} className="flex items-center gap-1.5 group">
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
            <PriorityDot priority={task.priority} editable={!locked} onChange={(p) => onPriority(task, p)} />
            <button
              type="button"
              onClick={() => onMoveNext(task)}
              title="Move to next day"
              className="text-slate-300 hover:text-blue-600 text-xs opacity-0 group-hover:opacity-100 shrink-0"
            >
              →
            </button>
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
          className="w-full text-xs bg-white/70 rounded-md px-2 py-1 border border-transparent focus:border-slate-300 focus:outline-none"
        />
      </form>

      {meetings.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/70 space-y-1.5">
          {meetings.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenMeeting(m)}
              className="w-full flex items-center gap-1.5 text-xs text-left border-l-[3px] border-violet-500 bg-violet-50 hover:bg-violet-100 rounded-r-md pl-1.5 pr-2 py-1"
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
      map.set(t.date, [...(map.get(t.date) ?? []), t]);
    }
    return map;
  }, [tasks]);
  const meetingsByDate = useMemo(() => {
    const map = new Map<string, WorkspaceMeeting[]>();
    for (const m of meetings) {
      if (!dates.includes(m.date)) continue;
      map.set(m.date, [...(map.get(m.date) ?? []), m].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
    }
    return map;
  }, [meetings, dates]);

  const weekTaskTotal = useMemo(() => dates.reduce((n, d) => n + (tasksByDate.get(d)?.length ?? 0), 0), [dates, tasksByDate]);
  const weekTaskDone = useMemo(() => dates.reduce((n, d) => n + (tasksByDate.get(d)?.filter((t) => t.done).length ?? 0), 0), [dates, tasksByDate]);
  const weekMeetingTotal = useMemo(() => dates.reduce((n, d) => n + (meetingsByDate.get(d)?.length ?? 0), 0), [dates, meetingsByDate]);

  async function handlePriority(task: WorkspaceTask, priority: WorkspaceTask['priority']) {
    try {
      await updateWorkspaceTaskPriority(task, priority, reviewedToday);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority.');
    }
  }

  function handleMoveNext(task: WorkspaceTask) {
    const nextDate = addDays(task.date, 1);
    void moveWorkspaceTaskToDate(task.id, nextDate, tasksByDate.get(nextDate) ?? []);
  }

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{weekRangeLabel(weekStart)}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {weekTaskDone} of {weekTaskTotal} tasks done · {weekMeetingTotal} meeting{weekMeetingTotal === 1 ? '' : 's'}
          </p>
        </div>
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
          <button
            type="button"
            onClick={() => setDialog({ date: dates.includes(today) ? today : weekStart })}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shrink-0"
          >
            + Meeting
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <div className="flex items-stretch gap-3" style={{ width: 'max-content' }}>
          {dates.map((date) => (
            <div key={date} className="w-60 shrink-0">
              <DayColumn
                date={date}
                tasks={tasksByDate.get(date) ?? []}
                meetings={meetingsByDate.get(date) ?? []}
                locked={workspaceTaskPriorityLocked(date, today, tomorrow, reviewedToday)}
                myUid={profile.uid}
                today={today}
                tomorrow={tomorrow}
                onAdd={(title) => void addWorkspaceTask({ uid: profile.uid, date, title, existingOnDate: tasksByDate.get(date) ?? [] })}
                onToggle={(task) => void toggleWorkspaceTaskDone(task.id, !task.done)}
                onRename={(task, title) => void renameWorkspaceTask(task.id, title)}
                onPriority={handlePriority}
                onDelete={(task) => void deleteWorkspaceTask(task.id)}
                onMoveNext={handleMoveNext}
                onOpenMeeting={(meeting) => setDialog({ meeting })}
              />
            </div>
          ))}
        </div>
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
