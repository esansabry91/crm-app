import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';
import { isAdminRole } from '../types';

/** Subscribes to the tenders visible to the current user: all of them for admins, own-only for staff. */
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
    const q =
      isAdminRole(profile.role)
        ? query(base, orderBy('updatedAt', 'desc'))
        : query(base, where('ownerUid', '==', profile.uid), orderBy('updatedAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setTenders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) })));
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
