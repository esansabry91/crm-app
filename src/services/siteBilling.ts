import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { SiteBillingRate } from '../types';

/** Minimal shape of a Duty Roster `sites/{id}` doc this feature needs — mirrors the same local
 *  pattern TestingDataTool.tsx uses (there's no shared Site type in types.ts; that collection is
 *  owned by public/duty-roster/index.html's own data model). `billingRates` is the one field this
 *  side of the app actually writes to that collection — everything else here is read-only. */
export interface BillingSite {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  tenderId: string | null;
  billingRates: SiteBillingRate[];
}

export function useSitesForBilling() {
  const [sites, setSites] = useState<BillingSite[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'sites'),
      (snap) => {
        setSites(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              name: (data.name as string) || 'Untitled site',
              branch: (data.branch as string) ?? null,
              archived: !!data.archived,
              tenderId: (data.tenderId as string) ?? null,
              billingRates: Array.isArray(data.billingRates) ? (data.billingRates as SiteBillingRate[]) : [],
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);
  return { sites, loading };
}

/** Overwrites a site's whole billing-rates list — the invoice generator's rate-editor always
 *  sends the complete list back (add/remove/edit all happen client-side first), so a full
 *  replace is simpler and safer here than trying to patch individual array entries. */
export async function updateSiteBillingRates(siteId: string, rates: SiteBillingRate[]): Promise<void> {
  await updateDoc(doc(db, 'sites', siteId), { billingRates: rates, updatedAt: new Date().toISOString() });
}
