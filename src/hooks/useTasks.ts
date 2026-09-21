import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { StaffTask } from '../types';

// How long to wait before re-establishing a listener that failed with permission-denied — see
// the retry doc comment inside the effect below for why this is safe to do unconditionally.
const RETRY_DELAY_MS = 2000;

/**
 * Subscribes to the whole `tasks` collection, unfiltered — matches this codebase's established
 * pattern of skipping composite indexes in favor of a plain collection listener plus client-side
 * filtering (see useGuards/useUsers). firestore.rules is what actually scopes what comes back: a
 * Branch Manager only ever receives their own department's tasks, an Operation Staff account
 * only ever receives tasks assigned to them, and admin-tier roles see everything. TaskBoardPage
 * further splits this into the Open/Completed views and the monthly reset client-side.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [loading, setLoading] = useState(true);
  // Set only when the subscription itself fails (almost always a Firestore permission-denied —
  // see firestore.rules' /tasks read rule) — deliberately kept distinct from `tasks` being empty,
  // which is the normal "nothing assigned" case. Without this, TaskBoardPage had no way to tell
  // "no tasks" apart from "the read was silently denied and nobody knows why the board looks
  // empty" — see the doc comment on the banner in TaskBoardPage.tsx for the incident this covers.
  const [error, setError] = useState<string | null>(null);
  // Bumped to force the effect below to tear down and re-create the listener after a failure —
  // see the retry doc comment inside the effect for why.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = onSnapshot(
      collection(db, 'tasks'),
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
        // Retry rather than leaving the board permanently blank: by the time this hook is even
        // mounted, ProtectedRoute has already confirmed this account's own profile (role,
        // department, active) is valid and readable — so a permission-denied here is virtually
        // never a REAL access problem. In practice it's a listener that got established in the
        // brief window right around a hard page refresh's auth-restoration, which Firestore's SDK
        // treats as a terminal failure and never retries on its own even once the exact same auth
        // context that every other query on the page succeeds with has settled in. This was the
        // root cause of Task Board (and Pipeline Analysis's trend/bridge charts, see
        // useTenderHistory.ts) staying blank after a refresh until the user manually signed out
        // and back in — tearing down and re-subscribing after a short delay self-heals it instead.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  return { tasks, loading, error };
}
