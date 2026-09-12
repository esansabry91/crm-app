import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export interface ConfirmedMonthSummary {
  manHours: number;
  amount: number;
  byName?: string;
  at?: string;
}

/**
 * Reads a Duty Roster site's month doc (`sites/{siteId}/months/{monthKey}` — owned by
 * public/duty-roster/index.html's own data model, not src/types.ts, same as BillingSite in
 * services/siteBilling.ts) for its `invoiceConfirmed` snapshot: the man-hours and RM amount a
 * branch manager or branch staff locked in by clicking "Confirm for invoicing" on that month's
 * plain Summary Report. `monthKey` must be "YYYY-MM" (zero-padded month) — the exact format both
 * an `<input type="month">` value and Duty Roster's own monthKey() use, so no conversion is
 * needed. Live-subscribed so a confirmation made in another tab/device shows up without a
 * reload. Returns null (not an error) when the site+month combination has never been confirmed —
 * the Branch Collection invoice generator still lets you invoice without one, just without a
 * figure to reconcile against.
 */
export function useConfirmedMonthSummary(siteId: string | null, monthKey: string) {
  const [confirmed, setConfirmed] = useState<ConfirmedMonthSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!siteId || !monthKey) {
      setConfirmed(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'sites', siteId, 'months', monthKey),
      (snap) => {
        const data = snap.data() as { invoiceConfirmed?: ConfirmedMonthSummary } | undefined;
        setConfirmed(data?.invoiceConfirmed || null);
        setLoading(false);
      },
      () => {
        setConfirmed(null);
        setLoading(false);
      }
    );
    return unsub;
  }, [siteId, monthKey]);

  return { confirmed, loading };
}
