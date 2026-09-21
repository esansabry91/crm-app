import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { StaffTask } from '../types';

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
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'tasks'),
      (snap) => {
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
        console.error('useTasks subscription error', err);
        setError(err.code ? `${err.code}: ${err.message}` : err.message || String(err));
        setLoading(false);
      }
    );
    return unsub;
  }, []);
  return { tasks, loading, error };
}
