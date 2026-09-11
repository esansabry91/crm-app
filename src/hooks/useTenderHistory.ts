import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, TenderHistoryEntry } from '../types';

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
 */
export function useTenderHistory(tenders: Tender[]) {
  const [entriesByTender, setEntriesByTender] = useState<Record<string, TenderHistoryEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const unsubsRef = useRef<Record<string, () => void>>({});
  const seenRef = useRef<Set<string>>(new Set());

  // Stable key so the effect below only re-runs when the SET of tender ids actually changes,
  // not on every re-render of the (new-array-each-time) tenders prop.
  const idsKey = [...new Set(tenders.map((t) => t.id))].sort().join(',');

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    const currentIds = new Set(ids);

    // Tear down listeners for tenders no longer in scope (filtered out, deleted, etc.).
    for (const id of Object.keys(unsubsRef.current)) {
      if (!currentIds.has(id)) {
        unsubsRef.current[id]();
        delete unsubsRef.current[id];
        seenRef.current.delete(id);
        setEntriesByTender((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }

    // Start listeners for newly-visible tenders.
    for (const id of ids) {
      if (unsubsRef.current[id]) continue;
      unsubsRef.current[id] = onSnapshot(
        collection(db, 'tenders', id, 'history'),
        (snap) => {
          setEntriesByTender((prev) => ({
            ...prev,
            [id]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TenderHistoryEntry, 'id'>) })),
          }));
          seenRef.current.add(id);
          if (seenRef.current.size >= currentIds.size) setLoading(false);
        },
        (err) => {
          console.error(`useTenderHistory subscription error (tender ${id})`, err);
          seenRef.current.add(id);
          if (seenRef.current.size >= currentIds.size) setLoading(false);
        }
      );
    }

    if (ids.length === 0) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Tear every listener down on unmount.
  useEffect(() => {
    return () => {
      Object.values(unsubsRef.current).forEach((unsub) => unsub());
      unsubsRef.current = {};
    };
  }, []);

  const entries = Object.values(entriesByTender).flat();

  return { entries, loading };
}
