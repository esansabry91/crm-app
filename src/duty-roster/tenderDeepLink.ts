/**
 * Duty Roster page shell — the tender ("Active Project") deep link. Ported from
 * public/duty-roster/index.html's deep-link param read (lines 1284-1287),
 * findAnySiteForTenderId() (5857-5862), handleTenderDeepLinkIfNeeded() (5864-5911), and
 * createSite() (5819-5833).
 *
 * Confirmed (see the inventory this was built from) that the handoff from Active
 * Projects/LinkedSiteDetailsCard into this page is a PLAIN URL query string
 * (`?tenderId=&clientName=&branch=&siteId=`, forwarded verbatim by DutyRosterPage.tsx onto the
 * iframe's own `src` today) — never `postMessage`. That makes this module pure
 * `URLSearchParams` parsing plus two Firestore calls (an existence check, and the actual
 * create), portable as-is once the page stops being an iframe (Task #22).
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
import { collection, doc, getDocs, limit, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import type { SiteConfig } from "./types";
import { newId, nowIso, defaultSite } from "./rosterModel";
import type { RosterViewer } from "./rosterViewer";
import type { SiteListEntry } from "./siteListData";

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

/** findAnySiteForTenderId() — is there ALREADY a Duty Roster site for this tenderId anywhere,
 * even in a branch this viewer's own branch-scoped `useSiteList()` doesn't cover? Needed because
 * a non-privileged viewer's site list is branch-scoped (see useSiteList.ts) — "no site with this
 * tenderId in MY list" does not mean "no site exists", it can just mean the real one's `branch`
 * field points somewhere this viewer's listener doesn't reach. Without this check, two people
 * opening the same project's Duty Roster link from two different branches would each get their
 * own createSite() call, silently producing a duplicate. `firestore.rules`' read rule already
 * widens access to a Won tender's current branch/owner/HQ for any of its linked sites regardless
 * of that site's OWN branch, so this plain query correctly finds it instead of erroring for
 * exactly the people who'd actually hit this path. */
export async function findAnySiteForTenderId(tenderId: string): Promise<{ id: string; branch: string | null } | null> {
  try {
    const snap = await getDocs(query(collection(db, "sites"), where("tenderId", "==", tenderId), limit(1)));
    if (snap.empty) return null;
    const data = snap.docs[0].data() as Pick<SiteConfig, "branch">;
    return { id: snap.docs[0].id, branch: data.branch || null };
  } catch {
    return null;
  }
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
  onToast: (message: string) => void;
}

/** handleTenderDeepLinkIfNeeded() — acts on the deep link once `sites` reflects reality: selects
 * the matching site if one already exists, otherwise creates it (bare-tenderId case only — a
 * `siteId`-targeted deep link never creates a fallback, see the doc comment on `DeepLinkParams`).
 * No-ops once handled (latched in `handledRef`, which — unlike `useState` — must never itself
 * trigger a re-render or reset across renders), and no-ops entirely when there's no deep link at
 * all. Re-evaluates whenever `sites` changes, matching the original being re-invoked on every
 * site-list snapshot update, until it latches. */
export function useTenderDeepLink(params: DeepLinkParams, sites: SiteListEntry[], viewer: RosterViewer, currentSiteId: string | null, callbacks: UseTenderDeepLinkCallbacks): void {
  const handledRef = useRef(false);
  const inFlightRef = useRef(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (handledRef.current || inFlightRef.current) return;

    if (params.siteId) {
      // Targeting one specific already-created site — no create-if-missing fallback: if it
      // isn't in `sites` yet, this viewer just can't reach it (wrong branch, archived and
      // hidden, or a bad id) — leave `handledRef` false and let the normal site list/empty
      // state speak for itself rather than guessing.
      const existing = sites.find((s) => s.id === params.siteId);
      if (existing) {
        handledRef.current = true;
        if (currentSiteId !== existing.id) callbacksRef.current.onSwitchSite(existing.id);
      }
      return;
    }

    if (!params.tenderId) return;
    const tenderId = params.tenderId;
    const existing = sites.find((s) => s.tenderId === tenderId);
    if (existing) {
      handledRef.current = true;
      if (currentSiteId !== existing.id) callbacksRef.current.onSwitchSite(existing.id);
      return;
    }

    // Set BEFORE the async check below — later site-list updates (this effect re-runs on every
    // one, while `sites` keeps changing) must not re-enter this while the check is still in
    // flight, or they'd race into the exact double-create this check exists to prevent.
    handledRef.current = true;
    inFlightRef.current = true;
    findAnySiteForTenderId(tenderId)
      .then((found) => {
        if (found) {
          // A site already exists, just under a branch `sites` doesn't currently cover — don't
          // create a duplicate. It won't be selectable here either way (this viewer's
          // branch-scoped listener still won't return it); surface that plainly.
          callbacksRef.current.onToast("This project already has a Duty Roster site under a different branch — ask an Admin to check its branch assignment.");
          return;
        }
        return createSite(params.clientName || "New site", params.branch, tenderId, params.clientName, viewer).then((result) => {
          callbacksRef.current.onSiteCreated(result);
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [params.siteId, params.tenderId, params.clientName, params.branch, sites, currentSiteId, viewer]);
}
