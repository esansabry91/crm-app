import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { TaskTemplate, UserProfile } from '../types';
import { isAdminRole } from '../types';

// Same reasoning as useTasks.ts's own RETRY_DELAY_MS — a listener created in the narrow window
// right around a hard refresh's auth-restoration can fail with a transient permission-denied.
const RETRY_DELAY_MS = 2000;

/**
 * Subscribes to the recurring task templates this viewer is allowed to see — same department
 * scoping as useTasks.ts (admin: everything; Branch Manager: `where('department', '==',
 * profile.department)`), and for the same reason: firestore.rules' /taskTemplates read rule
 * depends on resource.data.department for a non-admin, so the query itself must filter on it or
 * Firestore denies the whole listen outright (see useTasks.ts's doc comment for the full
 * explanation of why that's unavoidable).
 *
 * Deliberately returns an empty list without subscribing at all for anyone who isn't
 * manager/admin — a plain staff account has no reason to see recurring templates (it only ever
 * sees the generated task instances, like any other task), and the /taskTemplates read rule
 * would deny it anyway.
 */
export function useTaskTemplates(profile: UserProfile | null) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const canManage = !!profile && (isAdminRole(profile.role) || profile.role === 'branchManager');

  useEffect(() => {
    if (!profile || !canManage) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const base = collection(db, 'taskTemplates');
    const q = isAdminRole(profile.role) ? query(base) : query(base, where('department', '==', profile.department));

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (cancelled) return;
        setTemplates(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaskTemplate, 'id'>) })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        console.error('useTaskTemplates subscription error', err);
        setError(err.code ? `${err.code}: ${err.message}` : err.message || String(err));
        setLoading(false);
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
  }, [profile?.uid, profile?.role, profile?.department, canManage, retryTick]);

  return { templates, loading, error };
}
