import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';

/**
 * Subscribes to every Won tender scoped by who's asking — the shared subscription behind both
 * useActiveProjects (still-running work) and usePastProjects (closed-out work):
 * - Admins and anyone in the "HQ" department see every Won tender firm-wide (HQ holds no
 *   active projects of its own, but oversees all of them).
 * - Everyone else sees Won tenders currently assigned to their own branch (`activeBranch`),
 *   regardless of who originally submitted them — PLUS any Won tender with a pending
 *   reassignment TO their branch (see Tender.pendingReassignment): `activeBranch` deliberately
 *   doesn't move until the receiving Branch Manager accepts it, so that has to be a second query
 *   merged in by id, not just a wider filter on the first one. Matches the (also two-clause) read
 *   rule in firestore.rules — keep the two in sync.
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
    const queries = seesAllBranches
      ? [query(base, where('stage', '==', 'Won'))]
      : [
          query(base, where('stage', '==', 'Won'), where('activeBranch', '==', profile.department)),
          query(base, where('stage', '==', 'Won'), where('pendingReassignment.toBranch', '==', profile.department)),
        ];

    // Merge-by-id across both queries (same shape as the duty-roster console's own multi-bucket
    // site merge) rather than picking one "authoritative" query — a tender can legitimately
    // appear in both once it's Won for this branch again later, and each query's snapshot fires
    // independently.
    const buckets: Tender[][] = queries.map(() => []);
    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) }));
          const seen = new Map<string, Tender>();
          buckets.forEach((list) => list.forEach((t) => seen.set(t.id, t)));
          setWonTenders(Array.from(seen.values()));
          setLoading(false);
        },
        (err) => {
          console.error('useWonTenders subscription error', err);
          setLoading(false);
        }
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
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
