import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { usersListPlan } from '../utils/firestoreAccess';

/**
 * Subscribes to exactly the team profiles this viewer is allowed to list, matching
 * firestore.rules' /users read rule — see usersListPlan() in utils/firestoreAccess.ts.
 *
 * This USED to be one unfiltered `collection(db, 'users')` listener for everyone, with a
 * comment claiming firestore.rules would silently drop whatever a given viewer isn't allowed
 * to see. That isn't how Cloud Firestore works: a LIST/listen is denied outright whenever the
 * rule depends on resource.data the query itself doesn't filter on. `isAdmin()` is
 * unconditionally true, so this looked fine in testing as an admin, but came back
 * permission-denied for every Branch Manager (and Operation Staff) account — emptying Admin
 * Settings → Team and the Task Board assignee picker for the people who actually use them.
 */
export function useUsers(profile: UserProfile | null) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const plan = usersListPlan(profile);
    if (plan.mode === 'none') {
      setUsers([]);
      setLoading(false);
      return;
    }

    const base = collection(db, 'users');
    // No orderBy: a compound equality query plus orderBy would need a composite index, and
    // Firestore's orderBy also silently drops docs missing the ordered field. Sort client-side
    // instead — same reasoning as useTenders().
    const q =
      plan.mode === 'all'
        ? query(base)
        : query(base, where('role', '==', 'dutyStaff'), where('department', '==', plan.department));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfile, 'uid'>) }));
        list.sort((a, b) => a.name.localeCompare(b.name));
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        console.error('useUsers subscription error', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [profile?.uid, profile?.role, profile?.department]);

  return { users, loading };
}
