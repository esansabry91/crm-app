import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where, type Query } from 'firebase/firestore';
import { db } from '../firebase';
import type { TenderSiteDetails, UserProfile } from '../types';
import { sitesListPlan } from '../utils/firestoreAccess';

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

interface LinkedSiteRaw {
  id: string;
  name: string;
  branch: string | null;
  archived: boolean;
  activeGuardCount: number;
  createdAt: string;
  linkedToTender: boolean;
}

function parseLinkedSite(id: string, data: DutyRosterSiteDoc, tenderId: string): LinkedSiteRaw {
  return {
    id,
    name: data.name || 'Untitled site',
    branch: data.branch || null,
    archived: !!data.archived,
    activeGuardCount: (data.guards || []).filter((g) => g.active !== false).length,
    createdAt: data.createdAt || '',
    linkedToTender: data.tenderId === tenderId,
  };
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
 *
 * Query constraints follow sitesListPlan() / firestore.rules' canReadSite(): an unconstrained
 * `where('tenderId','==',tenderId)` LIST is only safe for admin/HQ/payroll-like callers. For a
 * Branch Manager the /sites read rule still depends on `branch`, and Cloud Firestore denies the
 * whole LIST rather than dropping out-of-branch docs — which left Project Details stuck on its
 * loading spinner (this hook treated `rawSites === null` as "still loading", and the error
 * handler never cleared that). Non-privileged callers instead listen to their own branch plus
 * unassigned sites and filter to this tenderId client-side, matching useSiteList.ts.
 *
 * A site delegated to a different branch (canAssignSiteBranchViaTender, which uses get()) still
 * can't appear in a LIST — same pre-existing gap as useTenderHistory's ownerUid filter. Fixing
 * that fully would need the owning branch denormalized onto each site, which is out of scope
 * for restoring the own-branch case.
 */
export function useTenderSites(tenderId: string | null, profile: UserProfile | null) {
  const [rawSites, setRawSites] = useState<TenderLinkedSite[] | null>(null);
  const detailsUnsubsRef = useRef<Record<string, () => void>>({});
  const [detailsBySite, setDetailsBySite] = useState<Record<string, TenderSiteDetails | null>>({});

  useEffect(() => {
    setRawSites(null);
    setDetailsBySite({});
    Object.values(detailsUnsubsRef.current).forEach((unsub) => unsub());
    detailsUnsubsRef.current = {};
    if (!tenderId) return;

    const plan = sitesListPlan(profile);
    if (plan.mode === 'none') {
      // Signed-in but this role cannot LIST sites at all — not "still loading".
      if (profile) setRawSites([]);
      return;
    }

    const base = collection(db, 'sites');
    // Privileged callers can query by tenderId directly (their read is unconditional).
    // Everyone else queries by branch — unconstrained tenderId LISTs are denied — and filters
    // to this tender client-side.
    const queries: Query[] =
      plan.mode === 'all'
        ? [query(base, where('tenderId', '==', tenderId))]
        : [query(base, where('branch', '==', plan.department)), query(base, where('branch', '==', null))];
    const filterToThisTender = plan.mode !== 'all';

    const buckets: LinkedSiteRaw[][] = queries.map(() => []);

    const applyDocs = (docs: LinkedSiteRaw[]) => {
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
    };

    const recompute = () => {
      const seen = new Map<string, LinkedSiteRaw>();
      buckets.forEach((list) => list.forEach((s) => seen.set(s.id, s)));
      const docs = Array.from(seen.values())
        .filter((s) => !filterToThisTender || s.linkedToTender)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      applyDocs(docs);
    };

    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = snap.docs.map((d) => parseLinkedSite(d.id, d.data() as DutyRosterSiteDoc, tenderId));
          recompute();
        },
        (err) => {
          console.error('useTenderSites subscription error', err);
          buckets[i] = [];
          recompute();
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
      Object.values(detailsUnsubsRef.current).forEach((unsub) => unsub());
      detailsUnsubsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, profile?.uid, profile?.role, profile?.department]);

  // Merge in whatever details have arrived since rawSites was last computed (details docs can
  // resolve after the sites list itself, since they're separate listeners).
  const sites = (rawSites || []).map((s) => (s.isPrimary ? s : { ...s, details: detailsBySite[s.id] ?? s.details }));

  return { sites, loading: rawSites === null };
}
