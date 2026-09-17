/**
 * Duty Roster page shell — role derivation. Ported from public/duty-roster/index.html's
 * `initDb()` role-bootstrap block (lines ~6524-6560), MINUS the Firestore read it used to do
 * itself: the original re-read `users/{uid}` directly (`dbHandle.doc("users/"+uid).get()`)
 * because the standalone console had no other way to know who was signed in. Now that this is
 * native React inside the same CRM, that identity is already live via `useAuth()`
 * (`src/contexts/AuthContext.tsx`) — this module is purely the pure derivation of
 * isPrivileged/isPayroll/isHr/isPayrollLike/canEdit from a `UserProfile`, fed by whatever the
 * caller already has from `useAuth().profile`. Do NOT re-read `users/{uid}` anywhere in this
 * port — that would be the exact redundant read this rewrite is meant to drop.
 *
 * `isPrivileged`'s exact formula (verified against the live source, not assumed from the role
 * vocabulary alone): `isAdminRole(role) || department === "HQ"` — i.e. the same 5-role
 * "administrative access" set `src/types.ts`'s own `isAdminRole()` already defines
 * (admin/developer/ceo/director/tenderController), reused here rather than hand-rolled, PLUS
 * the HQ-department carve-out Duty Roster adds on top (an HQ-department account gets the same
 * every-branch reach even if their role itself is something else, e.g. `branchManager`).
 */
import { isAdminRole } from "../types";
import type { RosterSession } from "./rosterModel";

/** The subset of UserProfile this module actually needs — kept narrow so a caller doesn't have
 * to import the full CRM `UserProfile` type just to build one of these. */
export interface RosterViewerProfile {
  uid: string;
  name: string;
  role: string;
  department: string;
}

/** Everything the Duty Roster page shell (site picker, role lockdown, brand subtitle, Combined
 * Hours/Invoice confirm actor identity) derives from the signed-in user. Structurally a superset
 * of `RosterSession` (same `canEdit`/`isPrivileged`/`myRole` field names/types), so a
 * `RosterViewer` can be passed anywhere a `RosterSession` is expected without adapting it. */
export interface RosterViewer {
  myUid: string | null;
  myName: string | null;
  myRole: string | null;
  myDepartment: string | null;
  isPrivileged: boolean;
  isPayroll: boolean;
  isHr: boolean;
  /** isPayroll || isHr — the condition almost every payroll-lockdown check actually cares
   * about; kept as its own field since it's referenced so often (matches the original's own
   * `state.isPayrollLike`). Equivalent to `!canEdit` in this app (verified: `canEdit` has no
   * other assignment site) — combinedHoursData.ts already relies on that equivalence where only
   * a `RosterSession` is in scope; prefer this field directly wherever a full `RosterViewer` is
   * already in hand. */
  isPayrollLike: boolean;
  /** Dedicated testing account — full access like isPrivileged, but auto-tags isTestData:true
   * on everything it creates via createSite() (siteListData.ts). */
  isDeveloper: boolean;
  canEdit: boolean;
}

const UNSIGNED_VIEWER: RosterViewer = {
  myUid: null,
  myName: null,
  myRole: null,
  myDepartment: null,
  isPrivileged: false,
  isPayroll: false,
  isHr: false,
  isPayrollLike: false,
  isDeveloper: false,
  canEdit: true,
};

/** `profile` is `null` before auth/profile has resolved — returns the same inert defaults the
 * original's `state` object starts with before `initDb()`'s role block ever runs. */
export function deriveRosterViewer(profile: RosterViewerProfile | null): RosterViewer {
  if (!profile) return UNSIGNED_VIEWER;
  const isPrivileged = isAdminRole(profile.role) || profile.department === "HQ";
  const isPayroll = profile.role === "payroll";
  const isHr = profile.role === "hr";
  const isPayrollLike = isPayroll || isHr;
  return {
    myUid: profile.uid,
    myName: profile.name || null,
    myRole: profile.role || null,
    myDepartment: profile.department || null,
    isPrivileged,
    isPayroll,
    isHr,
    isPayrollLike,
    isDeveloper: profile.role === "developer",
    canEdit: !isPayrollLike,
  };
}

/** Narrows a RosterViewer down to the plain RosterSession shape, for call sites that want to be
 * explicit about depending only on the smaller, already-established interface. Rarely needed —
 * a RosterViewer satisfies RosterSession structurally as-is. */
export function toRosterSession(viewer: RosterViewer): RosterSession {
  return { canEdit: viewer.canEdit, isPrivileged: viewer.isPrivileged, myRole: viewer.myRole };
}
