/**
 * Pure decision for the Duty Roster tender deep link. Kept out of tenderDeepLink.ts so it can
 * be tested without initializing Firebase.
 *
 * The Active Projects "Duty Roster" link is `?tenderId=` (no siteId). The handler used to run
 * on the first render, when `useSiteList()` is still `[]`, latch, and then ask Firestore
 * `where('tenderId','==',…)`. That LIST is not provable against canReadSite() for a Branch
 * Manager or Operation Staff (the rule depends on `branch`, and rules are not filters), so the
 * query is permission-denied. The catch treated that as "no site exists" and createSite()
 * wrote a second roster for a project that already had one. An admin's query succeeded before
 * the listener did, showed "site is under a different branch", and never selected the real site.
 *
 * `sitesReady` is true only after every site-list listener has delivered its first snapshot
 * (a Branch Manager has two: own branch, and unassigned). The list is then exactly the set
 * this viewer is allowed to LIST, already sorted createdAt-ascending, so the first tenderId
 * match is the project's original site.
 *
 * A site that lives only on another branch still cannot be listed by a Branch Manager (same
 * gap as Project Details). This function does not fall back to a tenderId LIST: that query is
 * denied, and a caught denial is indistinguishable from "no document".
 */
export interface DeepLinkSiteRef {
  id: string;
  tenderId: string | null;
}

export type DeepLinkChoice =
  | { action: "wait" }
  | { action: "idle" }
  | { action: "select"; siteId: string }
  | { action: "create" };

export function chooseDeepLinkSite(input: {
  sitesReady: boolean;
  sites: DeepLinkSiteRef[];
  siteId: string | null;
  tenderId: string | null;
}): DeepLinkChoice {
  if (!input.sitesReady) return { action: "wait" };

  // A specific site id (LinkedSiteDetailsCard) never creates a fallback. If it isn't in the
  // reachable list yet, stay idle so a later snapshot can still select it.
  if (input.siteId) {
    const match = input.sites.find((s) => s.id === input.siteId);
    return match ? { action: "select", siteId: match.id } : { action: "idle" };
  }

  if (!input.tenderId) return { action: "idle" };

  const match = input.sites.find((s) => s.tenderId === input.tenderId);
  if (match) return { action: "select", siteId: match.id };
  return { action: "create" };
}
