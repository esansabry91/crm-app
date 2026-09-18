import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';
import { isAdminRole } from '../types';

/**
 * Subscribes to the tenders visible to the current user: all of them for admins, own-only for
 * staff.
 *
 * Deliberately sorts client-side instead of adding `orderBy('updatedAt', 'desc')` to the Firestore
 * query itself: Firestore's `orderBy` silently EXCLUDES any document that's missing the ordered
 * field, rather than sorting it last — so a tender written by anything other than this app's own
 * create/update code (a manual Firestore console entry, a data-migration/backfill script, an
 * older record from before `updatedAt` existed) would otherwise just vanish from the Sales Funnel
 * Pipeline board and the Archive page (both built on this hook) for EVERY account, admin included
 * — with no error, since the query still "succeeds," it just quietly returns fewer docs. Active
 * Projects doesn't have this failure mode because useWonTenders() (hooks/useActiveProjects.ts)
 * never orders by updatedAt at all — which is exactly why a tender can be visible there while
 * being invisible on Pipeline/Archive. Sorting the fetched docs here instead means a tender with
 * no updatedAt still comes back from the query (it just sorts as if it were the oldest).
 */
export function useTenders(profile: UserProfile | null) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setTenders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = collection(db, 'tenders');
    const q = isAdminRole(profile.role) ? query(base) : query(base, where('ownerUid', '==', profile.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) }));
        list.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
        setTenders(list);
        setLoading(false);
      },
      (err) => {
        console.error('useTenders subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.role]);

  return { tenders, loading };
}
