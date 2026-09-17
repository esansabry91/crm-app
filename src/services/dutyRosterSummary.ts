import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export interface ConfirmedCategoryManHours {
  category: string;
  headcount: number;
  manHours: number;
}

export interface ConfirmedMonthSummary {
  manHours: number;
  amount: number;
  byName?: string;
  at?: string;
  /** Man-hours from Duty Roster's "Additional Guard (Temporary)" posts this month — billed
   *  separately in Branch Collection, not included in manHours/amount above. See
   *  public/duty-roster/index.html's computeSummaryTotals()/totalExtraGuardManHours(). */
  additionalManHours?: number;
  /** Per-category headcount + man-hours breakdown snapshotted at the same "Confirm for
   *  invoicing" moment — see computeCategoryBreakdown()'s doc comment in
   *  src/duty-roster/payrollMath.ts for exactly how guards are bucketed by category (matches
   *  the site's own Guard Rate positions when in 'multiple' mode, one flat category in 'same'
   *  mode). Used by InvoiceGenerator/InvoiceSiteSection's "Pull from confirmed summary" to
   *  auto-fill man-hour-mode line items. Absent on a confirmation made before this field
   *  existed, or when the site had no linked rate config at confirm time. */
  categories?: ConfirmedCategoryManHours[];
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
