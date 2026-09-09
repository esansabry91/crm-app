import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';

/**
 * Subscribes to every Won tender scoped by who's asking — the shared subscription behind both
 * useActiveProjects (still-running work) and usePastProjects (closed-out work):
 * - Admins and anyone in the "HQ" department see every Won tender firm-wide (HQ holds no
 *   active projects of its own, but oversees all of them).
 * - Everyone else sees only Won tenders currently assigned to their own branch
 *   (`activeBranch`), regardless of who originally submitted them.
 * Matches the read rule in firestore.rules — keep the two in sync.
 */
export function useWonTenders(profile: UserProfile | null) {
  const [wonTenders, setWonTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);

  const seesAllBranches = profile?.role === 'admin' || profile?.department === 'HQ';

  useEffect(() => {
    if (!profile) {
      setWonTenders([]);
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
        setWonTenders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) })));
        setLoading(false);
      },
      (err) => {
        console.error('useWonTenders subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.department, profile?.role, seesAllBranches]);

  return { wonTenders, loading, seesAllBranches };
}

/** Won tenders whose project is still running — everything except closed-out ones. */
export function useActiveProjects(profile: UserProfile | null) {
  const { wonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const projects = useMemo(() => wonTenders.filter((t) => !t.closedOut), [wonTenders]);
  return { projects, loading, seesAllBranches };
}

/** Won tenders that have been closed out — finished projects, kept for the record. */
export function usePastProjects(profile: UserProfile | null) {
  const { wonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const projects = useMemo(() => wonTenders.filter((t) => t.closedOut), [wonTenders]);
  return { projects, loading, seesAllBranches };
}
