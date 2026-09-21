/**
 * Firestore LIST queries against /sites must match firestore.rules' canReadSite().
 *
 * An unfiltered `collection(db, 'sites')` listen/getDocs is denied for every role whose read
 * rule depends on `resource.data.branch` (Branch Manager, Operation Staff). Firestore rejects
 * the whole query rather than silently dropping unreadables — the same mechanism useTasks.ts
 * and useSiteList.ts already document. Admin-tier / HQ / payroll-like reads don't depend on
 * branch, so one unfiltered query is still correct for them.
 *
 * Non-privileged callers therefore need two queries merged client-side: their own department,
 * plus sites with `branch == null` (untagged sites stay open to every active user — see
 * firestore.rules' canReachSite()).
 */
import { collection, getDocs, onSnapshot, query, where, type DocumentData, type Query, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import { isAdminRole, type UserProfile } from '../types';

export function canListAllSites(profile: UserProfile): boolean {
  return isAdminRole(profile.role) || profile.department === 'HQ' || profile.role === 'payroll' || profile.role === 'hr';
}

function sitesListQueries(profile: UserProfile): Query<DocumentData>[] {
  const sitesCol = collection(db, 'sites');
  if (canListAllSites(profile)) return [sitesCol];
  const department = profile.department || null;
  return [query(sitesCol, where('branch', '==', department)), query(sitesCol, where('branch', '==', null))];
}

export interface SiteDocSnap {
  id: string;
  data: () => DocumentData;
}

function mergeSiteDocs(buckets: SiteDocSnap[][]): SiteDocSnap[] {
  const seen = new Set<string>();
  const merged: SiteDocSnap[] = [];
  for (const list of buckets) {
    for (const d of list) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push(d);
    }
  }
  return merged;
}

/** Live listener over every /sites doc this profile is allowed to LIST. */
export function subscribeReachableSites(
  profile: UserProfile,
  onDocs: (docs: SiteDocSnap[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const queries = sitesListQueries(profile);
  const buckets: SiteDocSnap[][] = queries.map(() => []);
  const unsubs = queries.map((q, i) =>
    onSnapshot(
      q,
      (snap) => {
        buckets[i] = snap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
        onDocs(mergeSiteDocs(buckets));
      },
      (err) => onError?.(err)
    )
  );
  return () => unsubs.forEach((u) => u());
}

/** One-shot getDocs of every /sites doc this profile is allowed to LIST. */
export async function getReachableSites(profile: UserProfile): Promise<SiteDocSnap[]> {
  const snaps = await Promise.all(sitesListQueries(profile).map((q) => getDocs(q)));
  return mergeSiteDocs(snaps.map((snap) => snap.docs.map((d) => ({ id: d.id, data: () => d.data() }))));
}
