import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { Tender, UserProfile } from '../types';
import { isAdminRole } from '../types';

/**
 * Subscribes to every Won tender scoped by who's asking — the shared subscription behind both
 * useActiveProjects (still-running work) and usePastProjects (closed-out work):
 * - Admins and anyone in the "HQ" department see every Won tender firm-wide (HQ holds no
 *   active projects of its own, but oversees all of them).
 * - Everyone else sees Won tenders currently assigned to their own branch (`activeBranch`),
 *   regardless of who originally submitted them — PLUS any Won tender with a pending
 *   reassignment TO their branch (see Tender.pendingReassignment): `activeBranch` deliberately
 *   doesn't move until the receiving Branch Manager accepts it, so that has to be a second query
 *   merged in by id, not just a wider filter on the first one. Matches the (also two-clause) read
 *   rule in firestore.rules — keep the two in sync.
 */
export function useWonTenders(profile: UserProfile | null) {
  const [wonTenders, setWonTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);

  const seesAllBranches = isAdminRole(profile?.role) || profile?.department === 'HQ';

  useEffect(() => {
    if (!profile) {
      setWonTenders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = collection(db, 'tenders');
    const queries = seesAllBranches
      ? [query(base, where('stage', '==', 'Won'))]
      : [
          query(base, where('stage', '==', 'Won'), where('activeBranch', '==', profile.department)),
          query(base, where('stage', '==', 'Won'), where('pendingReassignment.toBranch', '==', profile.department)),
        ];

    // Merge-by-id across both queries (same shape as the duty-roster console's own multi-bucket
    // site merge) rather than picking one "authoritative" query — a tender can legitimately
    // appear in both once it's Won for this branch again later, and each query's snapshot fires
    // independently.
    const buckets: Tender[][] = queries.map(() => []);
    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tender, 'id'>) }));
          const seen = new Map<string, Tender>();
          buckets.forEach((list) => list.forEach((t) => seen.set(t.id, t)));
          setWonTenders(Array.from(seen.values()));
          setLoading(false);
        },
        (err) => {
          console.error('useWonTenders subscription error', err);
          setLoading(false);
        }
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [profile?.uid, profile?.department, profile?.role, seesAllBranches]);

  return { wonTenders, loading, seesAllBranches };
}


/**
 * Minimal shape of a Duty Roster site doc (public/duty-roster/index.html's own data model —
 * see firestore.rules' /sites block) that useLiveGuardCountsByTender actually reads. A guard
 * counts as active the same way the roster console itself treats it (active !== false — see
 * activeGuardsOn() there); temp/support guards are deliberately NOT counted here, since Active
 * Projects' "Guards Deployed" is meant to reflect a site's own permanent headcount, not who
 * happens to be borrowed in on a given day.
 */
interface DutyRosterSiteDoc {
  tenderId?: string | null;
  archived?: boolean;
  branch?: string | null;
  guards?: Array<{ active?: boolean }>;
}

/**
 * Live count of each Duty Roster site's currently-active permanent guards, keyed by the tender
 * it's linked to (site.tenderId, set once the first time someone opens that tender's Duty
 * Roster — see DutyRosterPage.tsx). Lets Active Projects show the site's real, up-to-the-second
 * headcount instead of the manually-typed guardsDeployed snapshot on the tender itself (see
 * ProjectDetailsModal.tsx) — the moment a guard is added or removed in the roster, this updates
 * everywhere Active Projects reads guardsDeployed, no manual re-entry needed.
 *
 * Only tenders with a live, non-archived site appear in the returned map at all — a tender with
 * no site yet (nobody's opened Duty Roster for it), or whose site was archived when the project
 * closed out, is absent, and callers should fall back to the tender's own guardsDeployed field
 * for those. If more than one non-archived site is ever linked to the same tenderId (shouldn't
 * normally happen, but acceptReassignment()'s 'new' choice can briefly leave an old one
 * unlinked rather than deleted), their active-guard counts are summed rather than picking one
 * arbitrarily.
 *
 * Read pattern mirrors the sites query in public/duty-roster/index.html: admins and HQ (the same
 * 'seesAllBranches' condition useWonTenders already computes) read every site; everyone else
 * reads only their own branch's sites plus any site with no branch set at all. dutyStaff/payroll
 * accounts never reach this page (Active Projects is hidden from both — see the Role doc comment
 * in types.ts), so there's no separate isPayroll case to mirror here.
 */
// Firestore 'in' queries cap at 30 values — a branch running more Active Projects than that at
// once (rare, but not impossible for a big branch) just gets its tenderId list split across more
// than one supplemental query below.
const TENDER_ID_QUERY_CHUNK = 30;

export function useLiveGuardCountsByTender(
  profile: UserProfile | null,
  seesAllBranches: boolean,
  // tenderIds this branch owns (activeBranch == profile.department) — see the supplemental
  // tenderId-based queries below for why a non-privileged caller needs to pass these in.
  ownedTenderIds: string[] = []
) {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  // Stable dependency for the effect below — an array literal from the caller changes identity
  // every render even when its contents don't, which would otherwise tear down and resubscribe
  // every query below on every single render.
  const ownedTenderIdsKey = seesAllBranches ? '' : [...ownedTenderIds].sort().join(',');

  useEffect(() => {
    if (!profile) {
      setCounts(new Map());
      return;
    }
    const base = collection(db, 'sites');
    const branchQueries = seesAllBranches
      ? [query(base)]
      : [query(base, where('branch', '==', profile.department)), query(base, where('branch', '==', null))];
    // Supplemental queries, non-privileged callers only: a site LINKED to one of this branch's
    // own tenders but DELEGATED to a different branch (see createTenderSite()'s branchOverride
    // param / ProjectDetailsModal.tsx's "Managing Branch" picker) won't match either branch
    // query above — its own `branch` field now names the delegate, not this one — so without
    // this, a delegated site's active guards would silently drop out of "Guards Deployed" for
    // the very project that's still this branch's own to run.
    const ownedTenderIdList = ownedTenderIdsKey ? ownedTenderIdsKey.split(',').filter(Boolean) : [];
    const tenderIdChunks: string[][] = [];
    for (let i = 0; i < ownedTenderIdList.length; i += TENDER_ID_QUERY_CHUNK) {
      tenderIdChunks.push(ownedTenderIdList.slice(i, i + TENDER_ID_QUERY_CHUNK));
    }
    const tenderQueries = tenderIdChunks.map((chunk) => query(base, where('tenderId', 'in', chunk)));
    const queries = [...branchQueries, ...tenderQueries];

    // Unlike before the tenderId queries existed, buckets can now overlap (an owner's own site
    // sharing a tenderId also matches one of the branch queries) — key by doc id across every
    // bucket so recompute() below sums each site's active guards exactly once regardless of how
    // many queries happened to return it.
    const buckets: Map<string, DutyRosterSiteDoc>[] = queries.map(() => new Map());
    const recompute = () => {
      const merged = new Map<string, DutyRosterSiteDoc>();
      buckets.forEach((bucket) => bucket.forEach((site, id) => merged.set(id, site)));
      const totals = new Map<string, number>();
      merged.forEach((site) => {
        if (!site.tenderId || site.archived) return;
        const activeGuards = (site.guards || []).filter((g) => g.active !== false).length;
        totals.set(site.tenderId, (totals.get(site.tenderId) || 0) + activeGuards);
      });
      setCounts(totals);
    };

    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          buckets[i] = new Map(snap.docs.map((d) => [d.id, d.data() as DutyRosterSiteDoc]));
          recompute();
        },
        (err) => {
          console.error('useLiveGuardCountsByTender subscription error', err);
        }
      )
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [profile?.uid, profile?.department, seesAllBranches, ownedTenderIdsKey]);

  return counts;
}

/** Won tenders whose project is still running — everything except closed-out ones. */
export function useActiveProjects(profile: UserProfile | null) {
  const { wonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const projects = useMemo(() => wonTenders.filter((t) => !t.closedOut), [wonTenders]);
  return { projects, loading, seesAllBranches };
}

/** Won tenders that have been closed out — finished projects, kept for the record. */
export function usePastProjects(profile: UserProfile | null) {
  const { wonTenders, loading, seesAllBranches } = useWonTenders(profile);
  const projects = useMemo(() => wonTenders.filter((t) => t.closedOut), [wonTenders]);
  return { projects, loading, seesAllBranches };
}
