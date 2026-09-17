/**
 * Live Firestore subscription + persist for a Duty Roster site config doc (`sites/{id}`) —
 * ported from public/duty-roster/index.html's persistConfig()/persistSiteConfig() (lines
 * ~6122-6134) plus the read side implicit in state.configsCache/subscribeSite().
 *
 * Porting note on revokeConfirmationIfPresent: the original revoked a Combined Hours/Invoice
 * confirmation on the CURRENT MONTH's cached state whenever a site config changed (since a
 * config edit — a new guard, a changed shift pattern — can invalidate an already-confirmed
 * figure), gated by the same `suppressConfirmRevoke` flag persistMonth() honors. That's the
 * caller's job here too: pass the current month's MonthState + its own setter/persist function
 * in `onConfigPersisted` if the caller wants that cross-doc side effect (kept out of this hook
 * so it doesn't have to know about month state at all — single responsibility, matches
 * useMonthState.ts's persist() already handling its own revoke on the month side for lock/draft
 * changes).
 */
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import type { SiteConfig } from "../types";
import { deepClone, nowIso } from "../rosterModel";

export interface UseSiteConfigResult {
  config: SiteConfig | null;
  loading: boolean;
  /** Persists a full, already-mutated SiteConfig (deep-cloned first, so the caller's own object
   * is never accidentally shared with Firestore's SDK internals) and updates local state
   * immediately (optimistic, matching the original's synchronous render() before the write
   * lands — unmounting doesn't cancel the underlying Firestore write, so there's no
   * cross-frame-style race to guard against here). Stamps `updatedAt` itself, same as
   * persistSiteConfig() always did, so callers never need to set it by hand. */
  persist: (next: SiteConfig) => Promise<void>;
}

export function useSiteConfig(siteId: string | null): UseSiteConfigResult {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId) {
      setConfig(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "sites", siteId),
      (snap) => {
        const data = snap.data() as SiteConfig | undefined;
        setConfig(data ? deepClone(data) : null);
        setLoading(false);
      },
      () => {
        setConfig(null);
        setLoading(false);
      }
    );
    return unsub;
  }, [siteId]);

  const persist = useCallback(
    async (next: SiteConfig) => {
      if (!siteId) return;
      const toWrite: SiteConfig = { ...deepClone(next), updatedAt: nowIso() };
      setConfig(toWrite);
      await setDoc(doc(db, "sites", siteId), toWrite);
    },
    [siteId]
  );

  return { config, loading, persist };
}
