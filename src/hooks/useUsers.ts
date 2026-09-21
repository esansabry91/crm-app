import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { isAdminRole } from '../types';

function mapUser(id: string, data: Omit<UserProfile, 'uid'>): UserProfile {
  return { uid: id, ...data };
}

/**
 * Subscribes to team-member profiles this viewer is allowed to LIST, matching firestore.rules'
 * /users read rule: admin-tier roles get the whole collection; a Branch Manager gets only
 * Operation Staff in their own department; everyone else gets their own profile doc.
 *
 * This USED to be one unfiltered `collection(db, 'users')` listener for everyone, with a
 * comment claiming it was admin-only. It isn't — Pipeline, Archive, Task Board, and Admin >
 * Team all call this hook, including as a Branch Manager (and Task Board as Operation Staff).
 * The /users read rule for a non-admin depends on `resource.data.role`/`department` (or uid),
 * and Cloud Firestore denies a LIST/listen outright whenever a rule depends on resource.data
 * the query doesn't filter on. Same mechanism as useTasks.ts: looked fine as an admin, came
 * back permission-denied for every Branch Manager, 100% of the time — empty Team list, empty
 * Task Board assignee picker.
 */
export function useUsers(profile: UserProfile | null) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const fail = (err: Error) => {
      console.error('useUsers subscription error', err);
      setLoading(false);
    };

    let unsub: Unsubscribe;

    if (isAdminRole(profile.role)) {
      const q = query(collection(db, 'users'), orderBy('name', 'asc'));
      unsub = onSnapshot(
        q,
        (snap) => {
          setUsers(snap.docs.map((d) => mapUser(d.id, d.data() as Omit<UserProfile, 'uid'>)));
          setLoading(false);
        },
        fail
      );
    } else if (profile.role === 'branchManager') {
      // Both filters are required for Firestore to prove the LIST matches
      // isOwnBranchOperationStaff() — department-only would also match this manager's own
      // profile and any other non-dutyStaff account in the branch, which the rule rejects,
      // denying the whole query. Sort client-side so we don't also need name in the composite
      // index (see firestore.indexes.json).
      const q = query(
        collection(db, 'users'),
        where('role', '==', 'dutyStaff'),
        where('department', '==', profile.department)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => mapUser(d.id, d.data() as Omit<UserProfile, 'uid'>));
          list.sort((a, b) => a.name.localeCompare(b.name));
          setUsers(list);
          setLoading(false);
        },
        fail
      );
    } else {
      unsub = onSnapshot(
        doc(db, 'users', profile.uid),
        (snap) => {
          setUsers(snap.exists() ? [mapUser(snap.id, snap.data() as Omit<UserProfile, 'uid'>)] : []);
          setLoading(false);
        },
        fail
      );
    }

    return unsub;
  }, [profile?.uid, profile?.role, profile?.department]);

  return { users, loading };
}
