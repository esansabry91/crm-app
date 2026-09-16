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
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'tasks'),
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffTask, 'id'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('useTasks subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, []);
  return { tasks, loading };
}
