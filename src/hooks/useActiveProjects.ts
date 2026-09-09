import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';

/**
 * Subscribes to "Active Projects" — Won tenders — scoped by who's asking:
 * - Admins and anyone in the "HQ" department see every Won tender firm-wide (HQ holds no
 *   active projects of its own, but oversees all of them).
 * - Everyone else sees only Won tenders currently assigned to their own branch
 *   (`activeBranch`), regardless of who originally submitted them.
 * Matches the read rule in firestore.rules — keep the two in sync.
 */
export function useActiveProjects(profile: UserProfile | null) {
  const [projects, setProjects] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);

  const seesAllBranches = profile?.role === 'admin' || profile?.department === 'HQ';

  useEffect(() => {
    if (!profile) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = collection(db, 'tenders');
    const q = seesAllBranches
      ? query(base, where('stage', '==', 'Won'))
      : query(base, where('stage', '==', 'Won'), where('activeBranch', '==', profile.department));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('useActiveProjects subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.department, profile?.role, seesAllBranches]);

  return { projects, loading, seesAllBranches };
}
