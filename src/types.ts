// Core domain types shared across the app.

/**
 * 'dutyStaff' is a separate, narrower role from 'branchManager' — a "Staff" account can ONLY
 * reach the Duty Roster tab (see hideFromStaff in ProtectedRoute/App.tsx and the nav gating in
 * AppLayout); it has no access to Pipeline, Pipeline Analysis, Active/Past Projects, or
 * Admin Settings. Deliberately NOT called 'staff' — that string is still in flight as the
 * legacy value some old 'branchManager' accounts haven't been migrated off yet (see the
 * migration banner in UserManager.tsx); reusing it here would make the two unrelated meanings
 * indistinguishable for any account caught mid-migration.
 *
 * 'payroll' is Duty-Roster-only like 'dutyStaff' (same hideFromStaff gating), but strictly
 * view/export — it can see every tab in the Duty Roster tool across every branch/site, but
 * can't edit anything there beyond using the two Export to Excel buttons. The lockdown itself
 * lives in public/duty-roster/index.html (state.isPayroll / the "readonly-mode" body class) and
 * in firestore.rules (isPayroll() is read-only everywhere); this Role value is just what routes
 * an account into that mode.
 */
export type Role = 'admin' | 'branchManager' | 'dutyStaff' | 'payroll';

/** The 8 fixed pipeline stages, in kanban column order. */
export const STAGES = [
  'New Lead',
  'Qualified Lead',
  'Prepare Proposal',
  'Submitted',
  'Negotiation',
  'Won',
  'Lost',
  'Disqualified Lead',
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages that still count as "open" / active pipeline (not yet a final outcome). */
export const OPEN_STAGES: Stage[] = [
  'New Lead',
  'Qualified Lead',
  'Prepare Proposal',
  'Submitted',
  'Negotiation',
];

// Disqualified Lead counts as "closed" here (it's a final outcome, not open pipeline), but
// pipelineSummary()'s winRate math deliberately does NOT use this constant — it checks
// stage === 'Won'/'Lost' directly, so a disqualified lead (screened out before ever being a real
// opportunity) never dilutes the win rate the way folding it into "closed" there would.
export const CLOSED_STAGES: Stage[] = ['Won', 'Lost', 'Disqualified Lead'];

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: Role;
  /** Branch name this staff member belongs to, or "HQ". Admins may be HQ-wide. */
  department: string;
  active: boolean;
  createdAt: number;
}

export interface Branch {
  id: string;
  name: string;
  createdAt: number;
}

export interface Brand {
  id: string;
  name: string;
  createdAt: number;
}

export interface Tender {
  id: string;
  clientName: string;
  brandId: string;
  brandName: string; // denormalized for display without extra lookups
  department: string; // branch name, or "HQ"
  contractStart: string; // ISO date (yyyy-mm-dd)
  contractEnd: string; // ISO date (yyyy-mm-dd)
  tenderValue: number; // in RM
  stage: Stage;
  ownerUid: string;
  ownerName: string; // denormalized
  notes?: string;
  /** ISO date (yyyy-mm-dd) the tender was actually won/lost — only meaningful when stage is Won or Lost. */
  closedDate?: string;
  /**
   * ISO date (yyyy-mm-dd) a New Lead was disqualified — only meaningful when stage is
   * Disqualified Lead. Set exactly once, automatically, by disqualifyTender() the moment the
   * "Disqualify" button on a New Lead card is confirmed (see TenderCard.tsx) — there's no manual
   * date picker for this anywhere, unlike closedDate, since disqualifying only ever happens now,
   * not backdated. Cleared (set back to null) if the tender is later moved to any other stage.
   * Together with closedDate, this is what isTenderArchived() in services/tenders.ts measures
   * the 1-year-old threshold against for the Sales Funnel board hiding it into Archive.
   */
  disqualifiedDate?: string;
  /**
   * ISO date (yyyy-mm-dd) the tender was submitted to the client — captured exactly once, the
   * first time the tender enters the "Submitted" stage (required at that point, and validated
   * client-side to never be a future date), so it can be compared against closedDate later to
   * measure time-to-convert. Deliberately write-once from a non-admin's side: firestore.rules
   * lets the owner set it while it's still unset, but rejects any change to an already-set value
   * unless the caller is admin — a Branch Manager who needs it corrected has to ask HQ. Stays on
   * the tender permanently once set, even if the stage later moves on to Negotiation/Won/Lost or
   * regresses to an earlier stage.
   */
  submittedDate?: string;
  /**
   * The branch actually running the awarded contract — only meaningful once stage is Won.
   * Defaults to `department` (the branch that submitted/owns the tender) the moment it's won,
   * but an admin can reassign it afterwards from the Active Projects page — e.g. HQ wins a
   * tender but a specific branch ends up delivering it. Kept separate from `department` so
   * sales-attribution charts (credit for winning the deal) aren't affected by later
   * operational reassignment (who's now running it).
   */
  activeBranch?: string;
  /**
   * A reassignment an admin has requested but the RECEIVING branch hasn't accepted yet (see
   * requestReassignBranch() in services/tenders.ts). While this is set, `activeBranch` is
   * deliberately left untouched — the project and its Duty Roster stay fully live under the
   * CURRENT branch, so there's never a coverage gap while the move is pending. The receiving
   * branch's Branch Manager sees it in their own Active Projects list (a widened read rule lets
   * them see a tender pending TO their branch even though activeBranch isn't theirs yet) and
   * calls acceptReassignment() to resolve it — choosing whether the existing Duty Roster site
   * comes with it or a fresh one gets created — which is what actually flips `activeBranch` and
   * clears this field. An admin can also retract an unaccepted request with cancelReassignment().
   */
  pendingReassignment?: { toBranch: string; fromBranch: string | null; requestedAt: number } | null;
  /**
   * Operational detail fields for an Active Project — only meaningful once stage is Won.
   * Editable by the tender's admin/owner AND by anyone else who can see it in Active Projects
   * (branch-mates in the same `activeBranch`, plus HQ) — see the widened update rule in
   * firestore.rules, which allows exactly these seven fields (not the rest of the tender) to be
   * changed by non-owners.
   */
  location?: string; // worksite / site address
  state?: string; // worksite state (e.g. Selangor, Johor)
  city?: string; // worksite city/town
  postcode?: string; // worksite postcode
  contactPerson?: string; // on-site or client contact (free text: name, phone, email, etc.)
  guardsDeployed?: number; // number of security guards currently deployed
  tenderDocNumber?: string; // official tender submission document number/ID
  /**
   * How permanent guards on this project's Duty Roster site(s) are billed to the client, per
   * man-hour actually worked (read live by public/duty-roster/index.html's Summary Report —
   * "home site view for invoice reference" — never snapshotted onto a guard, so editing a rate
   * here immediately changes every past and future guard's computed Amount there). 'same' means
   * every guard bills at `guardRate`; 'multiple' means each guard is assigned one of
   * `guardRatePositions` (matched by name) and bills at that position's rate. Undefined/unset
   * means no rate has been configured yet for this project — the roster then shows "Not set"
   * rather than a computed amount, exactly like every other not-yet-filled-in guard field.
   */
  guardRateMode?: 'same' | 'multiple';
  guardRate?: number; // RM per man-hour, used when guardRateMode is 'same'
  guardRatePositions?: { name: string; rate: number }[]; // RM per man-hour per named position, used when guardRateMode is 'multiple'
  /**
   * Marks a Won tender's project as finished/closed out — it stops appearing in Active Projects
   * (the list, its value totals, and the By Brand / By Branch breakdowns) and shows up in Past
   * Projects instead. Deliberately does NOT touch `stage` or `tenderValue`, and closing out never
   * writes a history entry — so the tender keeps counting as Won revenue forever in Performance
   * Analysis, staff performance, brand breakdown, and the sales race charts. Only the Active
   * Projects "which branch is currently running work" view (and its breakdowns) is affected.
   */
  closedOut?: boolean;
  closedOutAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Where a Guard Bank guard currently stands. Set automatically by the sync points described in
 * firestore.rules above the `guards` collection — never edited directly from either UI.
 * 'pool' = registered, no site yet. 'deployed' = assigned to a siteId/branch (kept in sync with
 * that site's own guards[] array inside public/duty-roster/index.html). 'dismissed' = terminated/
 * resigned/runaway, set ONLY from Duty Roster's "Dismiss" action.
 */
export type GuardStatus = 'pool' | 'deployed' | 'dismissed';

/** Reason chosen from Duty Roster's "Dismiss" dropdown — required whenever a guard's status
 *  becomes 'dismissed'. */
export type DismissalReason = 'Terminated' | 'Resigned' | 'Runaway';

/**
 * A firm-wide guard registry entry (top-level `guards` Firestore collection) — see the Guard
 * Bank page (src/pages/GuardBankPage.tsx) and the doc comment above the `guards` collection in
 * firestore.rules for the full sync-points story with public/duty-roster/index.html's own
 * per-site `guards[]` arrays. Field set mirrors the guard object Duty Roster's "Add guard" modal
 * builds (see openAddGuardModal() in index.html) plus Guard Bank's own status/assignment fields.
 */
export interface Guard {
  id: string;
  name: string;
  employeeId: string;
  category: 'local' | 'nepal';
  age?: number;
  state?: string;
  city?: string;
  position?: string;
  /** Nepal-category only. */
  passportNumber?: string;
  /** Nepal-category only — read by the "permit expiring within 2 months" stat tile. */
  permitExpiryDate?: string;
  /** Local-category only. */
  mykadNumber?: string;
  phoneNumber?: string;
  status: GuardStatus;
  /** Set once status is 'deployed'. */
  siteId?: string;
  siteName?: string;
  branch?: string | null;
  /**
   * The client brand this guard is deployed under — resolved from the deployed site's linked
   * tender (site.tenderId -> Tender.brandId/brandName) at sync/assign time and denormalized here,
   * the same way Tender itself denormalizes brandName. Best-effort: a site with no linked tender,
   * or a sync that can't read that tender (see firestore.rules' tender read scoping), leaves
   * these unset rather than blocking the rest of the sync. Kept (not cleared) once a guard is
   * dismissed, same as siteId/siteName/branch, so the Dismissed tab can still be filtered by the
   * brand they last worked under.
   */
  brandId?: string | null;
  brandName?: string | null;
  /** Set once status is 'dismissed'; cleared again if Duty Roster reactivates the guard. */
  dismissalReason?: DismissalReason;
  dismissedAt?: number;
  /**
   * Set by an admin's "Archive" action on a Dismissed guard (see archiveDismissedGuard() in
   * services/guards.ts) — hides them from the Dismissed Guards list without deleting the
   * record, so computeGuardTurnover()'s trailing-12-month rate still counts their dismissedAt.
   * Cleared again if Duty Roster reactivates the guard, same as dismissalReason/dismissedAt.
   */
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A one-off temporary guard used ad-hoc in Duty Roster (a "temp guard" slot entry — see
 * monthTempGuards() in index.html), recorded here purely for future contact. Deliberately has NO
 * linkage to `guards`/`sites` — see the doc comment above the `bufferGuards` collection in
 * firestore.rules. Deduped by name + MyKad number: reusing the same temp guard again just bumps
 * timesUsed/lastUsedAt instead of creating a duplicate row.
 */
export interface BufferGuard {
  id: string;
  name: string;
  rate: number;
  mykadNumber?: string;
  age?: number;
  phoneNumber?: string;
  state?: string;
  city?: string;
  /** Site/branch this buffer guard was most recently used at — contact context only. */
  lastSiteName?: string;
  lastBranch?: string | null;
  firstUsedAt: number;
  lastUsedAt: number;
  timesUsed: number;
}

/** One entry in a tender's audit trail, used to reconstruct the pipeline-value trend over time. */
export interface TenderHistoryEntry {
  id: string;
  tenderId: string;
  timestamp: number;
  type: 'created' | 'stage_change' | 'value_change' | 'updated' | 'deleted';
  stage: Stage;
  value: number;
  changedByUid: string;
  changedByName: string;
  fromStage?: Stage;
  ownerUid: string;
}
