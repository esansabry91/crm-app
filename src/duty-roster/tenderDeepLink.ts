/**
 * Duty Roster page shell — the tender ("Active Project") deep link. Ported from
 * public/duty-roster/index.html's deep-link param read (lines 1284-1287),
 * handleTenderDeepLinkIfNeeded() (5864-5911), and createSite() (5819-5833).
 * The old findAnySiteForTenderId() tenderId LIST is intentionally not ported — see
 * chooseDeepLinkSite() in tenderDeepLinkPlan.ts.
 *
 * Confirmed (see the inventory this was built from) that the handoff from Active
 * Projects/LinkedSiteDetailsCard into this page is a PLAIN URL query string
 * (`?tenderId=&clientName=&branch=&siteId=`, forwarded verbatim by DutyRosterPage.tsx onto the
 * iframe's own `src` today) — never `postMessage`. That makes this module
 * `URLSearchParams` parsing plus, when the reachable site list has no match, one Firestore
 * create. Whether a site already exists is decided from that list (see chooseDeepLinkSite),
 * not from a `where('tenderId','==',…)` LIST — that query is permission-denied for a Branch
 * Manager, and catching the error used to look like "no site" and create a duplicate.
 *
 * Deliberately NOT ported: the offline/local-only fallback branches this logic has in the
 * original (`bootLocalFallback()`'s own copy, and `currentConfig()`'s transient pre-load stub —
 * see the source inventory's §1/§4 for both). Both exist there only for the standalone static
 * page's "Firebase might not be configured yet, or `dbHandle` isn't ready when the very first
 * frame renders" cases — neither applies once this is native React composed inside an
 * already-signed-in, already-Firestore-connected CRM app (no synchronous pre-load gap the way a
 * fresh static-page load has one, and Firebase is always configured here). The "don't
 * prematurely latch `handled` before the real creation path can fire" bug the original's #4
 * stub specifically guards against (see its own inline comment) has no equivalent failure mode
 * in `useTenderDeepLink()` below either: `handledRef` is only ever set true in the same branch
 * that either found or is about to create the real site, never speculatively.
 */
import { useEffect, useRef } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { SiteConfig } from "./types";
import { newId, nowIso, defaultSite } from "./rosterModel";
import type { RosterViewer } from "./rosterViewer";
import type { SiteListEntry } from "./siteListData";
import { chooseDeepLinkSite } from "./tenderDeepLinkPlan";

export interface DeepLinkParams {
  tenderId: string | null;
  /** One specific already-created linked site (from LinkedSiteDetailsCard's own "Duty Roster"
   * action) — takes priority over `tenderId` when both are present. */
  siteId: string | null;
  clientName: string | null;
  branch: string | null;
}

export function parseDeepLinkParams(search: string | URLSearchParams): DeepLinkParams {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    tenderId: params.get("tenderId"),
    siteId: params.get("siteId"),
    clientName: params.get("clientName"),
    branch: params.get("branch"),
  };
}

export interface CreateSiteResult {
  id: string;
  config: SiteConfig;
  logText: string;
}

/** createSite() — tenderId links this site to the one Active Project it belongs to (optional:
 * Admin/HQ can still create a standalone site with no tender behind it). `archived` starts
 * false; only ever flipped by the tenders side's own archive/unarchive action (never from Duty
 * Roster — see rosterViewer.ts's doc comment). `publicHolidays`/`state`/`stateHolidayDates` are
 * set to their empty defaults explicitly here, matching `makeSampleConfig()`'s convention
 * (already ported) — the original's own literal write actually omits them and leans on
 * `configHolidays()`'s "default to [] on first read" normalization instead; writing the same
 * effective defaults eagerly here is behavior-identical and keeps this port's `SiteConfig`
 * values fully-shaped from the moment they're created. */
export async function createSite(name: string, branch: string | null, tenderId: string | null, clientName: string | null, viewer: RosterViewer): Promise<CreateSiteResult> {
  const id = newId("site");
  // A privileged user (admin, or HQ department) can pick any branch, or leave it unassigned;
  // anyone else can only ever create a site for their own branch — mirrored and enforced
  // server-side in firestore.rules' canReachSite().
  const assignedBranch = viewer.isPrivileged && !viewer.isPayrollLike ? branch || null : viewer.myDepartment || null;
  const config: SiteConfig = {
    id,
    name,
    branch: assignedBranch,
    tenderId: tenderId || null,
    clientName: clientName || null,
    archived: false,
    guards: [],
    site: defaultSite(),
    restRule: { restDaysPerWeek: 1, minRestHours: 12 },
    publicHolidays: [],
    state: null,
    stateHolidayDates: [],
    isSample: false,
    isTestData: !!viewer.isDeveloper,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await setDoc(doc(db, "sites", id), config);
  return { id, config, logText: `Created new site "${name}"${assignedBranch ? ` for branch "${assignedBranch}"` : ""}.` };
}

export interface UseTenderDeepLinkCallbacks {
  onSwitchSite: (siteId: string) => void;
  /** Called once a brand-new site has been created for a bare-tenderId deep link with no
   * existing match anywhere — the caller should switch to `result.id` and append
   * `result.logText` to the (now-current) month's log via its own persist path, matching every
   * other "write, then log" outcome shape elsewhere in this port. */
  onSiteCreated: (result: CreateSiteResult) => void;
}

/** handleTenderDeepLinkIfNeeded() — acts on the deep link once the reachable site list has
 * finished its first snapshot (`sitesReady`). Selects the matching site if one is already in
 * that list, otherwise creates it (bare-tenderId case only — a `siteId`-targeted deep link
 * never creates a fallback, see the doc comment on `DeepLinkParams`).
 *
 * Must not run the create branch while `sites` is still the initial empty array, or while only
 * one of a Branch Manager's two listeners (own branch / unassigned) has answered. That used to
 * latch `handledRef` immediately and then call a tenderId LIST that Firestore denies for anyone
 * whose /sites read depends on `branch`. The denial was swallowed, so createSite() ran and
 * wrote a second roster. No-ops once handled (latched in `handledRef`). A `siteId` that isn't
 * in the list yet stays unlatched so a later snapshot can still select it. */
export function useTenderDeepLink(
  params: DeepLinkParams,
  sites: SiteListEntry[],
  sitesReady: boolean,
  viewer: RosterViewer,
  currentSiteId: string | null,
  callbacks: UseTenderDeepLinkCallbacks
): void {
  const handledRef = useRef(false);
  const inFlightRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (handledRef.current || inFlightRef.current) return;

    const choice = chooseDeepLinkSite({
      sitesReady,
      sites,
      siteId: params.siteId,
      tenderId: params.tenderId,
    });
    if (choice.action === "wait" || choice.action === "idle") return;

    if (choice.action === "select") {
      handledRef.current = true;
      if (currentSiteId !== choice.siteId) callbacksRef.current.onSwitchSite(choice.siteId);
      return;
    }

    // Latch before the write so a site-list update while createSite() is in flight cannot
    // start a second one.
    handledRef.current = true;
    inFlightRef.current = true;
    createSite(params.clientName || "New site", params.branch, params.tenderId, params.clientName, viewer)
      .then((result) => {
        callbacksRef.current.onSiteCreated(result);
      })
      .catch((err) => {
        console.error("tender deep link createSite failed", err);
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [params.siteId, params.tenderId, params.clientName, params.branch, sites, sitesReady, currentSiteId, viewer]);
}
