import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { StaffTask, UserProfile } from '../types';
import { isAdminRole } from '../types';

// How long to wait before re-establishing a listener that failed with permission-denied —
// covers a genuinely transient case (e.g. a listener created in the narrow window right around
// a hard refresh's auth-restoration); see the retry doc comment inside the effect for details.
const RETRY_DELAY_MS = 2000;

/**
 * Subscribes to exactly the tasks this viewer is allowed to see, matching firestore.rules' /tasks
 * read rule: admin-tier roles get the whole collection unfiltered; a Branch Manager gets
 * `where('department', '==', profile.department)`; an Operation Staff account (the only other
 * role that reaches Task Board — see ProtectedRoute's hideFromStaff/hideHr on this route) gets
 * `where('assigneeUid', '==', profile.uid)`.
 *
 * This USED to be one unfiltered `collection(db, 'tasks')` listener for everyone, relying on
 * firestore.rules to silently drop whatever a given viewer isn't allowed to see (the same
 * pattern useGuards/useUsers use, where it's fine — see those hooks). It doesn't work here: the
 * /tasks read rule for a non-admin depends on `resource.data.department`/`assigneeUid`, and
 * Cloud Firestore denies a LIST/listen request outright — not per-document — whenever a rule
 * depends on resource.data that the query itself doesn't filter on, because it can't prove no
 * result would violate the rule. An admin's `isAdmin()` branch is unconditionally true regardless
 * of resource.data, so Firestore CAN prove that one is always safe — which is why this looked
 * fine in testing (as an admin) but came back permission-denied for every Branch Manager/
 * Operation Staff account, 100% of the time, refresh or not.
 */
export function useTasks(profile: UserProfile | null) {
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [loading, setLoading] = useState(true);
  // Set only when the subscription itself fails — deliberately kept distinct from `tasks` being
  // empty, which is the normal "nothing assigned" case. Without this, TaskBoardPage had no way
  // to tell "no tasks" apart from "the read was denied and nobody knows why the board looks
  // empty" — see the doc comment on the banner in TaskBoardPage.tsx for the incident this covers.
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the effect below to tear down and re-create the listener after a failure —
  // see the retry doc comment inside the effect for why.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!profile) {
      setTasks([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const base = collection(db, 'tasks');
    const q = isAdminRole(profile.role)
      ? query(base)
      : profile.role === 'branchManager'
        ? query(base, where('department', '==', profile.department))
        : query(base, where('assigneeUid', '==', profile.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        // progressUpdates defaults to [] for any task assigned before that field existed (it
        // was added after the first Task Board release) — Firestore simply omits a field that
        // was never written, so an older doc comes back with it `undefined` at runtime despite
        // StaffTask's type claiming it's always an array. Without this default, every access
        // to progressUpdates.length in TaskBoardPage crashed the whole page for any account
        // with a pre-existing task.
        setTasks(
          snap.docs.map((d) => {
            const data = d.data() as Omit<StaffTask, 'id'>;
            return { id: d.id, ...data, progressUpdates: data.progressUpdates || [] };
          })
        );
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        console.error('useTasks subscription error', err);
        setError(err.code ? `${err.code}: ${err.message}` : err.message || String(err));
        setLoading(false);
        // Retry after a short delay in case this specific failure IS one of the genuinely
        // transient ones (e.g. a listener that got created a beat before auth fully settled
        // right after a hard refresh) — harmless to retry even if it isn't transient, since a
        // real, persistent denial will just fail the same way again 2s later without harming
        // anything.
        retryTimer = setTimeout(() => {
          if (!cancelled) setRetryTick((n) => n + 1);
        }, RETRY_DELAY_MS);
      }
    );

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsub();
    };
  }, [profile?.uid, profile?.role, profile?.department, retryTick]);

  return { tasks, loading, error };
}
