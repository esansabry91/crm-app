/**
 * The first time a user opens the app each day, if they have tasks planned for today whose
 * priorities aren't confirmed yet, offer to review them in My Workspace > Today Tasks. Shown once
 * a day per browser; "Later" just closes it. Ported from gdsb-portal's own
 * DailyPriorityPrompt.tsx, self-contained here (own Firestore subscriptions) rather than reading
 * from a shared query cache, since crm-app has no TanStack Query layer — same self-contained-
 * watcher shape as NewTenderWatcher/TenderAssignedWatcher in components/notifications/, and
 * mounted the same way: once in App.tsx, alongside <Routes>, so it survives page navigation.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeMyWorkspaceTasks, subscribeWorkspaceDay } from '../../services/workspace';
import { greetingFor, hourInMalaysia, todayIso } from '../../utils/workspaceDates';

const KEY = 'ipsb-workspace-priority-prompt';

function shownToday(uid: string, date: string): boolean {
  try {
    return localStorage.getItem(`${KEY}:${uid}`) === date;
  } catch {
    return false;
  }
}
function markShown(uid: string, date: string) {
  try {
    localStorage.setItem(`${KEY}:${uid}`, date);
  } catch {
    // Without storage it may show again later today; harmless.
  }
}

export default function DailyPriorityPrompt() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [todayCount, setTodayCount] = useState(0);
  const [reviewed, setReviewed] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const today = todayIso();
    const unsubTasks = subscribeMyWorkspaceTasks(profile.uid, (tasks) => {
      setTodayCount(tasks.filter((t) => t.date === today && !t.done).length);
    });
    const unsubDay = subscribeWorkspaceDay(profile.uid, today, (day) => setReviewed(!!day?.prioritiesReviewedAt));
    return () => {
      unsubTasks();
      unsubDay();
    };
  }, [profile?.uid]);

  useEffect(() => {
    if (!profile) return;
    const today = todayIso();
    if (reviewed || todayCount === 0 || shownToday(profile.uid, today)) return;
    markShown(profile.uid, today);
    // Already on My Workspace — the review card there does the job, no need to also pop a modal.
    if (pathname !== '/my-workspace') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.uid, reviewed, todayCount]);

  if (!open || !profile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Review today's priorities"
        onClick={(e) => e.stopPropagation()}
        className="cel-card w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <p className="text-xl font-semibold text-slate-900">
          {greetingFor(hourInMalaysia(new Date()))}
          {profile.name ? `, ${profile.name}` : ''}!
        </p>
        <p className="mt-2 text-sm text-slate-700">
          You have {todayCount} task{todayCount === 1 ? '' : 's'} planned for today. Take a moment to check their priorities before
          you start.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/my-workspace');
            }}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Review priorities
          </button>
        </div>
      </div>
    </div>
  );
}
