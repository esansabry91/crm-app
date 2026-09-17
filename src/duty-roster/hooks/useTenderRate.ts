/**
 * Live-follows a site's linked tender (Active Project) for its guard-rate config — ported from
 * public/duty-roster/index.html's subscribeTenderRate() (lines ~6416-6449).
 *
 * Never a one-off read, per the original feature's "always live" design: editing a rate in
 * Project Details is reflected here (and in the invoice-reference Summary Report) immediately,
 * for every guard holding that position, without anyone needing to re-open anything.
 *
 * Deliberately TWO separate listeners, not one reading siteDetails only after the tender doc
 * resolves: this site's own `tenders/{tenderId}/siteDetails/{siteId}` doc when it has one (an
 * ADDITIONAL site that's had its own Guard Rate saved — see TenderSiteDetails in src/types.ts),
 * else the parent tender doc's top-level fields (the primary site's rate, or an additional
 * site's rate before its own has ever been saved) — same precedence
 * InvoiceGenerator.tsx/InvoiceSiteSection.tsx use on the CRM side. Needed as two listeners
 * because a site delegated to a branch other than the tender's own owning branch (see
 * firestore.rules' canAssignSiteBranchViaTender()) can read its own siteDetails doc fine but NOT
 * the parent tender doc at all — without this, that branch's Summary Report Rate/Amount columns
 * and per-guard billing rate would silently show blank for every guard on their own site.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import type { TenderRateConfig } from "../types";

export function useTenderRate(siteId: string | null, tenderId: string | null | undefined): TenderRateConfig | null {
  const [rate, setRate] = useState<TenderRateConfig | null>(null);

  useEffect(() => {
    setRate(null);
    if (!siteId || !tenderId) return;

    let latestTenderDocRate: TenderRateConfig | null = null;
    let latestSiteDetailsRate: TenderRateConfig | null = null;
    let cancelled = false;

    const recompute = () => {
      if (cancelled) return;
      setRate(latestSiteDetailsRate && latestSiteDetailsRate.guardRateMode ? latestSiteDetailsRate : latestTenderDocRate);
    };

    const unsubTender = onSnapshot(
      doc(db, "tenders", tenderId),
      (snap) => {
        latestTenderDocRate = snap.exists() ? ((snap.data() as TenderRateConfig) || null) : null;
        recompute();
      },
      () => {
        latestTenderDocRate = null;
        recompute();
      }
    );
    const unsubSiteDetails = onSnapshot(
      doc(db, "tenders", tenderId, "siteDetails", siteId),
      (snap) => {
        latestSiteDetailsRate = snap.exists() ? ((snap.data() as TenderRateConfig) || null) : null;
        recompute();
      },
      () => {
        latestSiteDetailsRate = null;
        recompute();
      }
    );

    return () => {
      cancelled = true;
      unsubTender();
      unsubSiteDetails();
    };
  }, [siteId, tenderId]);

  return rate;
}
