/**
 * Live Firestore subscription + persist for a Duty Roster month-state doc
 * (`sites/{id}/months/{YYYY-MM}`) — ported from public/duty-roster/index.html's
 * persistMonth()/persistMonthByKey() (lines ~6133-6144) and ensureMonthLoadedForDate()'s
 * emptyMonthState() fallback (line ~6098).
 *
 * `persist()` folds in exactly the two side effects the original always applied at the
 * persistence boundary, in the same order:
 *   1. revokeConfirmationIfPresent(), unless `suppressConfirmRevoke` is passed — this is what
 *      persistDraftChange() (locking/unlocking/dragging) uses to leave an already-confirmed
 *      Combined Hours/Invoice figure untouched, since a draft rearrangement not yet locked in
 *      hasn't actually changed anything committed yet.
 *   2. Stamps `updatedAt`.
 *
 * See useSiteConfig.ts's doc comment for why there's no postMessage/promise-await dance here:
 * unmounting a React component doesn't cancel an in-flight Firestore write the way tearing down
 * an iframe did, so the race condition that required suppressLockStatusPost simply doesn't have
 * an equivalent to guard against in the native-React version.
 */
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import type { MonthState } from "../types";
import { deepClone, emptyMonthState, nowIso, revokeConfirmationIfPresent } from "../rosterModel";

export interface UseMonthStateResult {
  ms: MonthState | null;
  loading: boolean;
  /** Persists a full, already-mutated MonthState. Pass `{ suppressConfirmRevoke: true }` for a
   * draft-only change (lock/unlock/discard/drag-swap) so an existing Combined Hours/Invoice
   * confirmation survives — see persistDraftChange()'s own callers in the original for exactly
   * which actions use this. */
  persist: (next: MonthState, opts?: { suppressConfirmRevoke?: boolean }) => Promise<void>;
}

export function useMonthState(siteId: string | null, monthKey: string | null): UseMonthStateResult {
  const [ms, setMs] = useState<MonthState | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId || !monthKey) {
      setMs(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "sites", siteId, "months", monthKey),
      (snap) => {
        const data = snap.data() as MonthState | undefined;
        setMs(data ? deepClone(data) : emptyMonthState(monthKey));
        setLoading(false);
      },
      () => {
        setMs(emptyMonthState(monthKey));
        setLoading(false);
      }
    );
    return unsub;
  }, [siteId, monthKey]);

  const persist = useCallback(
    async (next: MonthState, opts?: { suppressConfirmRevoke?: boolean }) => {
      if (!siteId || !monthKey) return;
      const toWrite = deepClone(next);
      if (!opts?.suppressConfirmRevoke) revokeConfirmationIfPresent(toWrite);
      toWrite.updatedAt = nowIso();
      setMs(toWrite);
      await setDoc(doc(db, "sites", siteId, "months", monthKey), toWrite);
    },
    [siteId, monthKey]
  );

  return { ms, loading, persist };
}
