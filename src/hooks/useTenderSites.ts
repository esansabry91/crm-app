import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { TenderSiteDetails } from '../types';

/** Raw shape of a `sites/{id}` doc as far as this hook cares — mirrors
 *  useActiveProjects.ts's own DutyRosterSiteDoc, kept separate since that file's version is
 *  scoped to guard-count aggregation only and this one needs a couple more display fields. */
interface DutyRosterSiteDoc {
  name?: string;
  branch?: string | null;
  tenderId?: string | null;
  archived?: boolean;
  createdAt?: string;
  guards?: Array<{ active?: boolean }>;
}

export interface TenderLinkedSite {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  activeGuardCount: number;
  /** True for whichever linked site is earliest-created — the ORIGINAL site every Won project
   *  already had before "+ Add Site" existed. Its guard rate/location/equipment continue to
   *  live on the Tender document's own top-level fields (see TenderSiteDetails' doc comment in
   *  types.ts) rather than a siteDetails doc — `details` is always null for this one. */
  isPrimary: boolean;
  /** Per-site override doc (tenders/{tenderId}/siteDetails/{this site's id}) — null for the
   *  primary site (see isPrimary above) and for any additional site that hasn't been saved to
   *  yet (a brand new site created via "+ Add Site" has no siteDetails doc until its first
   *  Save). */
  details: TenderSiteDetails | null;
}

/**
 * Live list of every Duty Roster site linked to one Tender (site.tenderId === tenderId),
 * combined with each additional site's own tenders/{tenderId}/siteDetails/{siteId} override doc
 * — powers Project Details' "Linked Sites" section (see ProjectDetailsModal.tsx). Scoped to a
 * single tenderId (unlike useLiveGuardCountsByTender in useActiveProjects.ts, which aggregates
 * across every reachable tender at once) since this only ever runs while one project's modal is
 * open.
 *
 * The overwhelming majority of projects have exactly one linked site — for those, `sites` comes
 * back as a single-element array with isPrimary: true and details: null, and callers should
 * keep rendering the existing single-site Location/Guard Rate/Equipment UI unchanged rather than
 * introducing "Linked Sites" chrome for a project that doesn't have more than one.
 */
export function useTenderSites(tenderId: string | null) {
  const [rawSites, setRawSites] = useState<TenderLinkedSite[] | null>(null);
  const detailsUnsubsRef = useRef<Record<string, () => void>>({});
  const [detailsBySite, setDetailsBySite] = useState<Record<string, TenderSiteDetails | null>>({});

  useEffect(() => {
    setRawSites(null);
    setDetailsBySite({});
    Object.values(detailsUnsubsRef.current).forEach((unsub) => unsub());
    detailsUnsubsRef.current = {};
    if (!tenderId) return;

    const unsubSites = onSnapshot(
      query(collection(db, 'sites'), where('tenderId', '==', tenderId)),
      (snap) => {
        const docs = snap.docs
          .map((d) => {
            const data = d.data() as DutyRosterSiteDoc;
            const activeGuardCount = (data.guards || []).filter((g) => g.active !== false).length;
            return {
              id: d.id,
              name: data.name || 'Untitled site',
              branch: data.branch || null,
              archived: !!data.archived,
              activeGuardCount,
              createdAt: data.createdAt || '',
            };
          })
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        const nextSites: TenderLinkedSite[] = docs.map((s, i) => ({
          id: s.id,
          name: s.name,
          branch: s.branch,
          archived: s.archived,
          activeGuardCount: s.activeGuardCount,
          isPrimary: i === 0,
          details: i === 0 ? null : detailsBySite[s.id] ?? null,
        }));
        setRawSites(nextSites);

        // Subscribe to each non-primary site's own siteDetails doc, and tear down any that no
        // longer apply (site unlinked/archived away, or removed from the list entirely).
        const extraIds = new Set(docs.slice(1).map((s) => s.id));
        for (const id of Object.keys(detailsUnsubsRef.current)) {
          if (!extraIds.has(id)) {
            detailsUnsubsRef.current[id]();
            delete detailsUnsubsRef.current[id];
          }
        }
        extraIds.forEach((id) => {
          if (detailsUnsubsRef.current[id]) return;
          detailsUnsubsRef.current[id] = onSnapshot(
            doc(db, 'tenders', tenderId, 'siteDetails', id),
            (dSnap) => {
              const details = dSnap.exists() ? (dSnap.data() as TenderSiteDetails) : null;
              setDetailsBySite((prev) => ({ ...prev, [id]: details }));
            },
            (err) => console.error(`useTenderSites siteDetails subscription error (site ${id})`, err)
          );
        });
      },
      (err) => console.error('useTenderSites subscription error', err)
    );

    return () => {
      unsubSites();
      Object.values(detailsUnsubsRef.current).forEach((unsub) => unsub());
      detailsUnsubsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);

  // Merge in whatever details have arrived since rawSites was last computed (details docs can
  // resolve after the sites list itself, since they're separate listeners).
  const sites = (rawSites || []).map((s) => (s.isPrimary ? s : { ...s, details: detailsBySite[s.id] ?? s.details }));

  return { sites, loading: rawSites === null };
}
