import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, TenderHistoryEntry, UserProfile } from '../types';
import { isAdminRole } from '../types';

// How long to wait before re-establishing a per-tender listener that failed — covers a
// genuinely transient case; see the retry doc comment inside the effect below, and useTasks.ts
// for the sibling case this mirrors.
const RETRY_DELAY_MS = 2000;

/**
 * Subscribes to the change-history log for exactly the tenders the caller can already see — the
 * same `tenders` array useTenders() returns — via one onSnapshot per tender's own
 * `tenders/{id}/history` subcollection, rather than a single collectionGroup('history') query
 * across the whole database. This is what powers the "pipeline value over time" trend chart and
 * the pipeline value bridge — see utils/analytics.ts.
 *
 * This used to be a single collectionGroup query, filtered by ownerUid for non-admins. Two
 * problems with that: a collectionGroup query has to be authorized against EVERY subcollection
 * anywhere in Firestore named 'history', not just the ones nested under tenders — so a single
 * stray 'history' subcollection created anywhere else (even by hand, testing in the console)
 * makes Firestore deny the WHOLE query, since it can't prove every possible match is covered by
 * a rule. It also duplicated the tenders read-scoping logic via an ownerUid filter that didn't
 * quite match it — a Branch Manager viewing Active Projects could see a Won tender assigned to
 * their branch but never its history, since they don't personally own it. Subscribing per tender
 * sidesteps both: it only ever reads `tenders/{id}/history` for ids already coming out of
 * useTenders() (so already correctly scoped for this viewer), and never touches a 'history'
 * subcollection anywhere else even if one happens to exist.
 *
 * The per-tender query still needs `where('ownerUid', '==', profile.uid)` for a non-admin caller,
 * though — the /history read rule (`isAdmin() || resource.data.ownerUid == request.auth.uid`)
 * depends on resource.data, and Cloud Firestore denies a LIST/listen request outright — not
 * per-document — whenever a rule depends on resource.data the query doesn't filter on, because
 * it can't prove no result would violate the rule. An admin's `isAdmin()` branch is
 * unconditionally true regardless of resource.data, so Firestore CAN prove that one is always
 * safe — which is why dropping the where() clause here (when this moved off collectionGroup)
 * looked fine in testing as an admin, but came back permission-denied for every non-admin caller,
 * 100% of the time, refresh or not. This does mean a Won tender delegated to this branch but
 * owned by someone else still won't have its history readable here — same pre-existing gap the
 * doc comment above already calls out; fixing that fully would need `activeBranch` denormalized
 * onto each history entry too, which is out of scope for restoring the self-owned case.
 */
export function useTenderHistory(tenders: Tender[], profile: UserProfile | null) {
  const [entriesByTender, setEntriesByTender] = useState<Record<string, TenderHistoryEntry[]>>({});
  const [loading, setLoading] = useState(true);
  // First error currently in effect, across every per-tender listener. Kept distinct from
  // `entries` being empty, which is also the normal "no history yet" case — see the banner in
  // AnalysisPage.tsx for why that distinction matters here.
  const [error, setError] = useState<string | null>(null);
  const unsubsRef = useRef<Record<string, () => void>>({});
  const seenRef = useRef<Set<string>>(new Set());
  const errorsRef = useRef<Record<string, string>>({});
  const retryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Bumped to force the effect below to notice a tender whose listener was torn down after a
  // failure and re-create it — see the retry doc comment below for why.
  const [retryTick, setRetryTick] = useState(0);

  const isAdmin = isAdminRole(profile?.role);
  const ownerUid = profile?.uid ?? null;

  // Stable key so the effect below only re-runs when the SET of tender ids actually changes,
  // not on every re-render of the (new-array-each-time) tenders prop.
  const idsKey = [...new Set(tenders.map((t) => t.id))].sort().join(',');

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const currentIds = new Set(ids);

    // Tear down listeners (and any pending retry) for tenders no longer in scope (filtered out,
    // deleted, etc.).
    for (const id of Object.keys(unsubsRef.current)) {
      if (!currentIds.has(id)) {
        unsubsRef.current[id]();
        delete unsubsRef.current[id];
        seenRef.current.delete(id);
        delete errorsRef.current[id];
        setError(Object.values(errorsRef.current)[0] || null);
        if (retryTimersRef.current[id]) {
          clearTimeout(retryTimersRef.current[id]);
          delete retryTimersRef.current[id];
        }
        setEntriesByTender((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Nothing to subscribe to without a signed-in profile (mirrors useTenders/useWonTenders) —
    // in practice `tenders` is always empty too whenever `profile` is null, since it comes from
    // one of those two hooks, so the teardown loop above has already cleared every listener by
    // the time we get here.
    if (!profile) {
      setLoading(false);
      return;
    }

    // Start listeners for newly-visible tenders (including ones a prior failure just tore down —
    // see the retry doc comment below).
    for (const id of ids) {
      if (unsubsRef.current[id]) continue;
      const historyCollection = collection(db, 'tenders', id, 'history');
      // See this hook's own doc comment: the where() clause is required for a non-admin, and
      // must be skipped (not just always-included with the admin's own uid) for an admin to see
      // every owner's entries, not just their own.
      const q = isAdmin ? query(historyCollection) : query(historyCollection, where('ownerUid', '==', ownerUid));
      unsubsRef.current[id] = onSnapshot(
        q,
        (snap) => {
          setEntriesByTender((prev) => ({
            ...prev,
            [id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TenderHistoryEntry, 'id'>) })),
          }));
          delete errorsRef.current[id];
          setError(Object.values(errorsRef.current)[0] || null);
          seenRef.current.add(id);
          if (seenRef.current.size >= currentIds.size) setLoading(false);
        },
        (err) => {
          console.error(`useTenderHistory subscription error (tender ${id})`, err);
          errorsRef.current[id] = err.code ? `${err.code}: ${err.message}` : err.message || String(err);
          setError(Object.values(errorsRef.current)[0] || null);
          seenRef.current.add(id);
          if (seenRef.current.size >= currentIds.size) setLoading(false);
          // Retry after a short delay in case this specific failure IS one of the genuinely
          // transient ones — harmless even if it isn't, since a real, persistent denial will
          // just fail the same way again 2s later without harming anything.
          unsubsRef.current[id]?.();
          delete unsubsRef.current[id];
          if (retryTimersRef.current[id]) clearTimeout(retryTimersRef.current[id]);
          retryTimersRef.current[id] = setTimeout(() => {
            delete retryTimersRef.current[id];
            setRetryTick((n) => n + 1);
          }, RETRY_DELAY_MS);
        }
      );
    }

    if (ids.length === 0) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, isAdmin, ownerUid, profile, retryTick]);

  // Tear every listener (and pending retry) down on unmount.
  useEffect(() => {
    return () => {
      Object.values(unsubsRef.current).forEach((unsub) => unsub());
      unsubsRef.current = {};
      Object.values(retryTimersRef.current).forEach((timer) => clearTimeout(timer));
      retryTimersRef.current = {};
    };
  }, []);

  const entries = Object.values(entriesByTender).flat();

  return { entries, loading, error };
}
