import { useEffect, useState } from 'react';
import { collectionGroup, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { TenderHistoryEntry, UserProfile } from '../types';

/**
 * Subscribes to the full change-history log across tenders (collectionGroup query), scoped the
 * same way as useTenders: admins see every entry, staff see only entries for tenders they own.
 * This log is what powers the "pipeline value over time" trend chart — see utils/analytics.ts.
 */
export function useTenderHistory(profile: UserProfile | null) {
  const [entries, setEntries] = useState<TenderHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = collectionGroup(db, 'history');
    const q =
      profile.role === 'admin'
        ? query(base, orderBy('timestamp', 'asc'))
        : query(base, where('ownerUid', '==', profile.uid), orderBy('timestamp', 'asc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TenderHistoryEntry, 'id'>) }))
        );
        setLoading(false);
      },
      (err) => {
        console.error('useTenderHistory subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.role]);

  return { entries, loading };
}
