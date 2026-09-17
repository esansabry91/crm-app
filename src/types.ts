// Core domain types shared across the app.

/**
 * 'dutyStaff' is a separate, narrower role from 'branchManager' — an "Operation Staff" account
 * (the UI label; see ROLE_LABELS in UserManager.tsx) can ONLY reach the Duty Roster tab (see
 * hideFromStaff in ProtectedRoute/App.tsx and the nav gating in AppLayout); it has no access to
 * Pipeline, Pipeline Analysis, Active/Past Projects, or Admin Settings. Deliberately NOT called
 * 'staff' — that string is still in flight as the legacy value some old 'branchManager' accounts
 * haven't been migrated off yet (see the migration banner in UserManager.tsx); reusing it here
 * would make the two unrelated meanings indistinguishable for any account caught mid-migration.
 *
 * 'payroll' is Duty-Roster-only like 'dutyStaff' (same hideFromStaff gating), but strictly
 * view/export — it can see every tab in the Duty Roster tool across every branch/site, but
 * can't edit anything there beyond using the two Export to Excel buttons. The lockdown itself
 * lives in public/duty-roster/index.html (state.isPayroll / the "readonly-mode" body class) and
 * in firestore.rules (isPayroll() is read-only everywhere); this Role value is just what routes
 * an account into that mode.
 *
 * 'hr' is identical to 'payroll' in every respect above (view/export-only, every-branch Duty
 * Roster access — see state.isPayrollLike in public/duty-roster/index.html and isPayrollLike()
 * in firestore.rules) EXCEPT it additionally gets full normal access to Guard Bank (/guards,
 * /bufferGuards — see hidePayrollOnly in ProtectedRoute.tsx, which only ever excludes literal
 * 'payroll', and isHr()/isPayroll() in firestore.rules, which /guards and /bufferGuards
 * deliberately keep checking separately so HR isn't swept into Payroll's Guard Bank lockout).
 *
 * 'finance' is Branch Collection-only — see hideFromFinance in ProtectedRoute/App.tsx and the
 * nav gating in AppLayout — and even within Branch Collection it only reaches the Invoices,
 * Debtor List and Revenue tabs (see BranchCollectionPage.tsx); it never sees Generate Invoice,
 * so it can't create a new invoice, and RevenuePanel's admin/branchManager-only Data
 * maintenance card stays out of reach the same way. It CAN record payments and edit an
 * existing invoice's status/amount paid in the Invoices tab, same as branchManager — see
 * isFinance() in firestore.rules, which is added alongside isBranchManager() to the
 * /invoices update rule but deliberately left out of the create rule.
 *
 * 'ceo', 'director', and 'tenderController' are deliberately just full HQ Admin access under a
 * different job title — see isAdminRole() below and isAdmin() in firestore.rules, both of which
 * treat them exactly like 'admin'. They do NOT get 'developer's isTestData auto-tagging — only a
 * literal 'developer' account does (see shouldStampTestData() in services/settings.ts).
 */
export type Role =
  | 'admin'
  | 'branchManager'
  | 'dutyStaff'
  | 'payroll'
  | 'developer'
  | 'finance'
  | 'hr'
  | 'ceo'
  | 'director'
  | 'tenderController';

/**
 * True for any role that should get full administrative access throughout the app — currently
 * 'admin', 'developer', 'ceo', 'director', and 'tenderController' (see the Role doc comment
 * above for why the latter three exist as their own role values instead of everyone just being
 * created as 'admin'). 'developer' exists purely so the account owner can sign in as a
 * dedicated testing account with the exact same access as a real admin, while every record it
 * creates gets auto-tagged isTestData: true (see shouldStampTestData() in services/settings.ts —
 * purely role-based, not tied to any shared/global setting) — so testing under this role can
 * never get mixed up with genuine data real staff/admin accounts create at the same time.
 * Always use this helper instead of comparing `role === 'admin'` directly, so a developer (or
 * ceo/director/tenderController) account is never accidentally left out of an admin-gated check.
 */
export function isAdminRole(role: Role | string | undefined | null): boolean {
  return (
    role === 'admin' ||
    role === 'developer' ||
    role === 'ceo' ||
    role === 'director' ||
    role === 'tenderController'
  );
}

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
  /**
   * The authorised signatory who signs invoices issued on behalf of this branch/department —
   * set once from Admin Settings > Branches & Brands, then looked up by the Branch Collection
   * tab's invoice generator from the Duty Roster site's own `branch` field (a Branch is a staff
   * department/office, e.g. "Penang Branch"; a Brand is the issuing legal entity on the
   * letterhead — the same person can sign for different brands under different titles, which is
   * why this lives here and not on Brand). Copied onto the Invoice itself at creation time so an
   * already-issued invoice's printed signatory never silently changes if this is edited later.
   */
  signatoryName?: string;
  signatoryTitle?: string;
  /** Short code used as the BRANCH segment of an auto-generated invoice number (e.g. "KV2") —
   *  see sanitizeInvoiceCode()'s doc comment in services/invoices.ts. Falls back to the
   *  branch's full `name` when unset. */
  shortCode?: string;
}

export interface Brand {
  id: string;
  name: string;
  createdAt: number;
  /**
   * Invoicing/legal details for this Brand — all optional so existing Brand docs (name + createdAt
   * only) keep working unedited. Set once per brand from Admin Settings > Branches & Brands, then
   * reused as the letterhead/bank details on every invoice generated for that brand under the
   * Branch Collection tab. A Brand is the ISSUING company on an invoice (e.g. "Prozas Security" vs
   * "Swift Eagle Security" — two differently-registered trading names a Won tender gets assigned
   * to), not the client being billed (that's Tender.clientName/department).
   */
  legalName?: string;
  registrationNo?: string;
  address?: string;
  tel?: string;
  fax?: string;
  serviceTaxNo?: string;
  tin?: string;
  bankName?: string;
  bankAccountName?: string;
  bankAccountNo?: string;
  bankAddress?: string;
  /** Small logo shown at the top of the invoice letterhead, as a data: URI (resized client-side
   *  before saving — see the upload control in BrandInvoicingDetails). Optional; the letterhead
   *  falls back to a text-only header when unset. */
  logoDataUrl?: string;
  /** Short code used as the BRAND segment of an auto-generated invoice number (e.g. "PZ") — see
   *  sanitizeInvoiceCode()'s doc comment in services/invoices.ts. Falls back to the brand's
   *  full `name` when unset. */
  shortCode?: string;
}

/**
 * One additional equipment/add-on item declared on a Won project's own Project Details (e.g. an
 * e-bike or drone the client asked for), in addition to guard headcount — see the "Additional
 * Equipment" section of ProjectDetailsModal.tsx, and addTenderEquipment()/
 * removeTenderEquipmentItem() in services/tenders.ts, which are the only ways this array is ever
 * written (never hand-edited elsewhere). Declared once per item, with its own `startDate` so an
 * item added mid-contract (not just from day one) is dated correctly — never earlier than the
 * tender's own contractStart. `valueContribution` is the one-time bump this item added to
 * tenderValue when it was declared (monthlyRate * quantity * whole months from startDate through
 * contractEnd at that moment — see wholeMonthsInclusive() in services/tenders.ts) — an ESTIMATE
 * of what this item adds to the deal's total worth over what's left of the contract, logged as
 * its own `value_change` history entry (same mechanism renewContract() uses) so the Active
 * Project Value Bridge picks it up as a value increase in the period it actually started, and so
 * removing the item later (removeTenderEquipmentItem()) can reverse EXACTLY this amount rather
 * than one re-derived from today's (possibly since-changed) rate/quantity/contractEnd.
 * Deliberately separate from Branch Collection's SiteEquipmentRate below, which stays a
 * site-level fallback catalog (no start date, no value tracking) for a site with no linked
 * project, or one that hasn't declared equipment here yet.
 */
export interface TenderEquipmentItem {
  id: string;
  item: string;
  monthlyRate: number;
  quantity: number;
  /** ISO date (yyyy-mm-dd) this equipment became part of the contract — never earlier than the
   *  tender's own contractStart. */
  startDate: string;
  valueContribution: number;
  addedAt: number;
  /**
   * Set once this item stops being deployed mid-contract (see stopTenderEquipmentItem() in
   * services/tenders.ts) — the item stays in `additionalEquipment` (unlike a full Remove, which
   * deletes it outright) so its "Equipment Added" history remains visible; only its future
   * value is reversed. Never earlier than `startDate`.
   */
  stoppedDate?: string;
  /**
   * How much of `valueContribution` was reversed when this item was stopped (the estimated
   * value for the months after `stoppedDate` through contractEnd) — stored, not re-derived, so
   * a later full Remove reverses exactly what's left (`valueContribution - stopValueReversal`)
   * rather than double-reversing. Present only alongside `stoppedDate`.
   */
  stopValueReversal?: number;
}

/**
 * Per-site override for a project that has MORE THAN ONE linked Duty Roster site under the same
 * contract (see "+ Add Site" in ProjectDetailsModal.tsx, and the `newSite=1` deep-link flag
 * handled by handleTenderDeepLinkIfNeeded() in public/duty-roster/index.html, which lets a
 * second-or-later site attach to a tenderId that already has one linked).
 *
 * Stored at tenders/{tenderId}/siteDetails/{dutyRosterSiteId} - one doc per EXTRA site, keyed by
 * that site's own Duty Roster site id (a direct 1:1 lookup). Deliberately NOT created for the
 * first/original site of a project: that site's guard rate, location, and equipment continue to
 * live on the Tender document's own top-level fields exactly as before this feature existed
 * (guardRateMode/guardRate/guardRatePositions/additionalEquipment/location/state/city/postcode/
 * contactPerson/lastGuardRateChange). This keeps every project that has only ever had one site -
 * effectively all of them as of this field's introduction - completely unmigrated; they simply
 * never get a siteDetails doc, and every existing reader of the top-level fields keeps working
 * unchanged.
 *
 * Contract value (tenderValue) is NOT part of this - it stays combined/shared at the Tender
 * level no matter how many sites are linked. Invoicing similarly stays combined per-tender for
 * now; splitting an invoice by site is an explicitly deferred fast-follow, not built yet.
 */
export interface TenderSiteDetails {
  dutyRosterSiteId: string; // = the doc id; duplicated here for convenience once spread out of a query
  siteName: string; // denormalized from the Duty Roster site's own name, for display without a join
  branch?: string | null; // denormalized from the Duty Roster site's own branch
  location?: string;
  state?: string;
  city?: string;
  postcode?: string;
  contactPerson?: string;
  // Denormalized copies of the parent tender's own clientAlias/clientAddress/tenderDocNumber/
  // brandId — kept in sync by saveTenderSiteLocationDetails() every time someone with full
  // access to the parent tender (its owner, admin, HQ, or its owning branch) saves this site's
  // location details. Exist ONLY so a branch this site has been delegated to (see
  // canAssignSiteBranchViaTender() in firestore.rules) — which can read this siteDetails doc but
  // NOT the parent tenders/{tenderId} doc itself — can still generate a correctly-addressed,
  // correctly-numbered invoice for its own site (InvoiceGenerator.tsx's invoice numbering keys
  // off clientAlias; the printed invoice needs clientAddress) without being granted read access
  // to the rest of the shared project record (tenderValue, other sites' pricing, etc.). See
  // InvoiceGenerator.tsx's site-switch effect for where these are read as a fallback.
  clientName?: string;
  clientAlias?: string | null;
  clientAddress?: string | null;
  tenderDocNumber?: string | null;
  brandId?: string;
  guardRateMode?: 'same' | 'multiple';
  guardRate?: number;
  guardRatePositions?: { name: string; rate: number }[];
  lastGuardRateChange?: { fromRate: number; toRate: number; changedAt: number; changedByName: string };
  additionalEquipment?: TenderEquipmentItem[];
  createdAt: number;
  updatedAt: number;
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
  /** Equipment/add-ons declared on this project beyond guard headcount — see
   *  TenderEquipmentItem's doc comment above. Absent/empty on a project with none declared. */
  additionalEquipment?: TenderEquipmentItem[];
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
   * Whether this is a Government or Private tender — asked once, compulsorily, the moment a
   * tender is registered (see TenderFormModal's Category field). Optional only in the type
   * system to cover tenders created before this field existed; every tender created (or later
   * edited/saved) through the form now has one. Drives whether submissionExpiryDate below is
   * required: a Private client can walk away the moment a cheaper quote expires, so its
   * submission needs a hard expiry date tracked; a Government tender's own procurement timeline
   * governs that instead, so it stays optional there — see SubmissionDateModal.tsx and
   * TenderFormModal's submissionExpiryDate field for where that's enforced.
   */
  category?: 'Government' | 'Private';
  /**
   * ISO date (yyyy-mm-dd) this lead's CURRENT contract — the one they already have with another
   * guard provider (or an existing one of ours coming up for renewal) — is due to end. Filled in
   * once a lead reaches Qualified Lead (see TenderFormModal's "Current Awarded Contract End"
   * field), since that's typically when this comes up in conversation; always optional, since not
   * every lead volunteers or even has one. Stays visible/editable at every later stage too, since
   * it remains useful context (e.g. as a renewal-timing reminder) long after the lead moves on
   * from Qualified Lead — see PipelinePage's "Contract ending soon" reminder tile, which flags
   * open (non-closed) tenders where this falls within 30 days (including already past).
   */
  currentContractEndDate?: string;
  /**
   * ISO date (yyyy-mm-dd) this tender's submission to the client expires — e.g. a quoted price
   * or tender validity period after which the client can no longer accept it as-is. Captured
   * alongside submittedDate the moment a tender first reaches Submitted (see
   * SubmissionDateModal.tsx), and freely correctable afterwards from TenderFormModal (unlike
   * submittedDate, there's no write-once/admin-only lock on this one). Compulsory at that point
   * for a Private tender (see `category` above) — a Government tender leaves it exactly as
   * optional as before this field existed. PipelinePage's "Submission expiring soon" reminder
   * tile flags any open (non-closed) tender where this falls within 30 days (including already
   * past), regardless of which stage it's since moved on to.
   */
  submissionExpiryDate?: string;
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
  /** Free-text summary of what the contract actually covers — e.g. which posts/shifts/duties are
   *  in scope — for anyone picking up this project to see at a glance without digging through the
   *  Tender Document PDF. Same widened Active Project detail fields as tenderDocNumber above (see
   *  firestore.rules), so branch-mates/HQ can fill it in without being the owner. */
  scopeOfWork?: string;
  /**
   * The uploaded tender document PDF (see ProjectDetailsModal's upload widget), stored in
   * Backblaze B2 — never a public URL. `tenderDocumentKey`/`tenderDocumentFileId` are B2's own
   * identifiers (used by worker/index.ts to fetch/delete the file); the frontend never talks to
   * B2 directly, only to the /api/tenders/:id/document Worker route, which re-checks Firestore
   * permissions (via this SAME firestore.rules update rule) before touching B2. All four fields
   * are set/cleared together (all five, not just the four named above) — see
   * firestorePatchTenderDocument() in worker/index.ts.
   */
  tenderDocumentKey?: string;
  tenderDocumentFileId?: string;
  tenderDocumentName?: string; // original filename, for display only
  tenderDocumentSize?: number; // bytes
  tenderDocumentUploadedAt?: number; // epoch millis, same convention as updatedAt
  /** Short code identifying the client on an auto-generated invoice number (e.g. "MDEC") — see
   *  sanitizeInvoiceCode()'s doc comment in services/invoices.ts. Falls back to `clientName`
   *  when unset. Also part of the same widened Active Project detail fields as tenderDocNumber
   *  above (see firestore.rules), so branch-mates/HQ can fill it in without being the owner. */
  clientAlias?: string;
  /** The client's billing address, printed on the invoice — distinct from `location` above
   *  (that's the worksite address; a client's registered/billing address can differ). */
  clientAddress?: string;
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
   * Snapshot of the most recent Guard Rate change (see applyGuardRateChange() in
   * services/tenders.ts) — shown as an inline note in Project Details ("Rate last changed from
   * RM X to RM Y on ...") so that's visible without a full history/activity feed. Absent until
   * the first rate CHANGE after this field was introduced (a first-time rate declaration, with
   * no prior rate, doesn't set it — that's not a change). Overwritten by each new change; only
   * the most recent one is kept.
   */
  lastGuardRateChange?: { fromRate: number; toRate: number; changedAt: number; changedByName: string };
  /**
   * Whether this Won project has a single Duty Roster site or several under the same contract
   * (see TenderSiteDetails above) — asked once, up front, the first time anyone opens Project
   * Details for a project that hasn't answered yet (see ProjectDetailsModal.tsx's own site-mode
   * chooser). 'single' hides the "Linked Sites" section/"+ Add Site" button entirely, since it
   * will never apply; 'multiple' shows it from the start. Absent/undefined means not asked yet
   * — EXCEPT a project that already has more than one linked site (from before this field
   * existed) is treated as 'multiple' without ever asking, since the answer is already evident
   * from its data. A "Change" link in ProjectDetailsModal.tsx clears this field (see
   * resetTenderSiteMode()) to revisit the choice.
   */
  siteMode?: 'single' | 'multiple';
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
  /**
   * Set true at creation time whenever Testing Mode was on (see AppSettings.testingModeEnabled
   * and src/services/settings.ts) — marks this as throwaway demo/testing content rather than a
   * genuine sales record, so it can be found and bulk-removed later via
   * scripts/purge-test-data.mjs's --test-data mode without touching real data. Never set on a
   * tender created while Testing Mode was off, and never changed after creation.
   */
  isTestData?: boolean;
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
  /** Same meaning and lifecycle as Tender.isTestData — see its doc comment. */
  isTestData?: boolean;
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
  /** Same meaning and lifecycle as Tender.isTestData — see its doc comment. */
  isTestData?: boolean;
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
  /**
   * Only meaningful when `type` is 'value_change' — what actually drove the change, so the
   * Active Project Value Bridge (see activeProjectValueBridge() in utils/analytics.ts) can show
   * each cause as its own waterfall bar instead of lumping every mid-contract value change into
   * one generic "Value Adjustments" bar:
   *  - 'renewal': renewContract() — a straight renewal whose rate changed.
   *  - 'equipment_increase': addTenderEquipment() — a new Additional Equipment item declared.
   *  - 'equipment_decrease': removeTenderEquipmentItem() or stopTenderEquipmentItem() — an
   *    equipment item's value contribution reversed, in full (removed) or in part (stopped).
   *  - 'guard_rate': applyGuardRateChange() — Guard Rate edited in Project Details.
   * Undefined (including every entry logged before this field existed) falls back to the
   * catch-all "Value Adjustments" bar — e.g. a plain updateTender() edit to tenderValue, or
   * historical data that predates reason-tagging.
   */
  valueChangeReason?: 'renewal' | 'equipment_increase' | 'equipment_decrease' | 'guard_rate';
}

/**
 * The single settings/app document (see firestore.rules' /settings block) — app-wide toggles
 * that both the CRM and public/duty-roster/index.html read. Currently just Testing Mode: see
 * src/services/settings.ts (React side) and index.html's state.testingModeEnabled (Duty Roster
 * side) for how each side keeps this in sync and stamps new records with isTestData while it's
 * on. Toggled from src/components/admin/TestingDataTool.tsx, admin-only.
 */
export interface AppSettings {
  testingModeEnabled: boolean;
  updatedAt: number;
  updatedByName?: string;
}

// ---- Branch Collection (billing / invoicing) ----

/**
 * One billable position category at a Duty Roster site, with its contracted hourly rate — e.g.
 * { category: "Security Officer", hourlyRate: 11.45 }. Stored as `sites/{id}.billingRates` (a
 * new field on the existing Duty Roster site doc, written from the CRM side only — Duty Roster's
 * own vanilla-JS app never reads or writes this field). Set once per site in the invoice
 * generator, then reused every month so headcount/days are the only things typed per invoice.
 */
export interface SiteBillingRate {
  category: string;
  hourlyRate: number;
}

/**
 * A recurring monthly add-on item billed alongside guard headcount — e-bikes, drones, patrol
 * vehicles, and similar equipment a client needs at a site, in addition to guard posts. Stored as
 * `sites/{id}.equipmentRates` (mirrors SiteBillingRate/`billingRates`'s own pattern exactly: set
 * once per site in the invoice generator, then reused every month). Deliberately a flat monthly
 * rate, not an hourly one like guard categories — equipment isn't billed per shift, so
 * InvoiceEquipmentRow below has no headcount/days/hours multiplication, just quantity *
 * monthlyRate. `quantity` is this item's usual month-to-month count at this site (e.g. "2
 * e-bikes") — saved here so InvoiceGenerator's equipment rows prefill it too, the same way
 * monthlyRate already did, since most sites need the same count every month; still a plain
 * editable number per invoice for the odd month it actually changes. Optional/defaults to 0 so
 * sites/items saved before this field existed keep working.
 */
export interface SiteEquipmentRate {
  item: string;
  monthlyRate: number;
  quantity?: number;
}

/** Which formula an invoice's (or, for a combined invoice, one site's) line items are billed
 *  with — see InvoiceLineRow's doc comment for what each mode does to `amount`. Absent on every
 *  invoice saved before this feature existed; those are always treated as 'headcount', the
 *  original and still-default behavior. Chosen once per site (Invoice.billingMode for the
 *  primary site, InvoiceSiteBill.billingMode for each additional one) — every row within that
 *  site's line items shares the same mode, rather than a per-row choice. */
export type InvoiceBillingMode = 'headcount' | 'manhour';

/** One row within an invoice line group — one guard category's billing for one location.
 *  `amount` is computed one of two ways depending on the site's InvoiceBillingMode:
 *  'headcount' (the original, still-default behavior) is headcount * days * 12 (a 12-hour
 *  shift) * rate; 'manhour' is `manHours` * rate directly, for a post whose actual hours don't
 *  divide evenly into whole guard-days (temp/support coverage, partial shifts) — see
 *  computeLineAmount()/computeManHourLineAmount() in services/invoices.ts. `amount` is always
 *  stored alongside the inputs so a saved invoice's total never silently drifts if either
 *  formula changes later. `headcount`/`days` are unused (kept at 0) on a 'manhour'-mode row, and
 *  `manHours` is unused (kept at 0/absent) on a 'headcount'-mode row — never both meaningful at
 *  once. */
export interface InvoiceLineRow {
  category: string;
  headcount: number;
  days: number;
  /** Total man-hours for this row, used only when this row's site is in 'manhour' billing mode
   *  — see InvoiceBillingMode's doc comment. Absent/0 on a 'headcount'-mode row, and on every
   *  row saved before this feature existed. */
  manHours?: number;
  rate: number;
  amount: number;
}

/** One physical location/post within a site's invoice — e.g. "MDEC HQ" vs "eXpats SERVICE
 *  CENTRE" on the same site's invoice. Typed manually per invoice (see Role/Brand doc comments
 *  for why this isn't derived automatically from Duty Roster data). */
export interface InvoiceLineGroup {
  location: string;
  rows: InvoiceLineRow[];
}

/**
 * One equipment/add-on row on an invoice — e.g. 2 e-bikes at RM800/month each. `amount` is
 * quantity * monthlyRate, stored alongside the inputs like InvoiceLineRow's amount, for the same
 * "never silently drifts" reason. Deliberately NOT grouped by location the way guard rows are
 * (InvoiceLineGroup) — equipment isn't tied to a post, so an invoice's equipment rows sit in one
 * flat list (Invoice.equipmentRows) alongside, not inside, its lineGroups. An invoice can carry
 * equipment rows alone (a standalone equipment invoice), lineGroups alone (guard-only, the
 * original shape), or both together in the same invoice — whichever the branch wants for that
 * billing month.
 */
export interface InvoiceEquipmentRow {
  item: string;
  quantity: number;
  monthlyRate: number;
  amount: number;
}

/**
 * One additional site's billing section within a combined invoice — see the "combine invoicing"
 * design: a single invoice can bill several sites of the same multi-site tender together, laid
 * out "grouped by site" (one invoice number, one PDF, but each site keeps its own guard-rate
 * categories/headcount cap/equipment as its own labeled section with its own subtotal, rolling up
 * into one grand total). The Invoice's own top-level siteId/siteName/lineGroups/equipmentRows
 * continue to describe the FIRST (primary-selected) site exactly as before this feature — this
 * array holds any EXTRA sites added on top of that first one. Absent/empty on every invoice that
 * bills only one site (the original, still-default shape).
 */
export interface InvoiceSiteBill {
  siteId: string;
  siteName: string;
  lineGroups: InvoiceLineGroup[];
  equipmentRows: InvoiceEquipmentRow[];
  /** This site's own billing mode — see InvoiceBillingMode's doc comment. Independent of the
   *  primary site's own Invoice.billingMode and of every other additional site on the same
   *  combined invoice; absent/'headcount' on a site added before this feature existed. */
  billingMode?: InvoiceBillingMode;
  /** This site's own subtotal (its lineGroups + equipmentRows amounts), computed and stored the
   *  same way Invoice.subTotal is, so it never silently drifts and prints instantly without
   *  re-deriving it. Folded into the invoice's overall subTotal/sstAmount/total. */
  subTotal: number;
}

/** 'void' marks an invoice that was wrongly generated and cancelled — see voidInvoice() in
 *  services/invoices.ts. A voided invoice keeps its invoiceNo (numbering is never reused/reset)
 *  and stays visible in the Invoices list for audit purposes, but is excluded from the Debtor
 *  List's outstanding figures and the Revenue tab's totals, and can no longer be edited or have
 *  payments recorded against it. */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

/**
 * A single monthly invoice generated from the Branch Collection tab. `brandId`/`brandName`
 * denormalize which of the company's brands (see Brand's doc comment) is issuing it — that
 * brand's invoicing details (services/branches.ts) supply the letterhead/bank details when the
 * invoice is printed. `siteId` links back to the Duty Roster site this was billed for (nullable
 * since a site can later be deleted without breaking a historical invoice).
 */
/** One entry in an Invoice's paymentLog — recorded automatically whenever a status update in
 *  InvoiceList's editor actually moves the amountPaid total (see updateInvoiceStatus in
 *  services/invoices.ts). `amount` is the size of THIS installment (the change in amountPaid),
 *  not the new running total — amountPaid on the Invoice itself is still the cumulative figure,
 *  this log is what lets "last paid" and full payment history be shown without that cumulative
 *  total having overwritten the previous entry's details. */
export interface InvoicePayment {
  amount: number;
  /** Date this installment was recorded as paid (yyyy-mm-dd), as entered in the status editor. */
  date: string;
  recordedAt: number;
  recordedByUid: string;
  recordedByName: string;
}

export interface Invoice {
  id: string;
  brandId: string;
  brandName: string;
  /** The Branch record matching the site this invoice was generated from (see Branch's doc
   *  comment) — null when the invoice has no linked site/branch. Snapshotted at creation like
   *  brandId/brandName, so it stays put even if a Branch is later renamed, and so the Debtor
   *  List can filter by branch without re-deriving it from siteId every time. */
  branchId?: string | null;
  branchName?: string;
  siteId: string | null;
  siteName: string;
  tenderId: string | null;
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  invoiceNo: string;
  invoiceDate: string;
  billingMonth: string;
  /** The `<input type="month">` value ("2026-08") billingMonth was formatted from — kept
   *  alongside the prose string so the Revenue tab can group/sort/filter by month without having
   *  to parse "August 2026" back apart. Absent on invoices saved before the Revenue tab existed;
   *  those fall back to invoiceDate's own month there. */
  billingMonthKey?: string;
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  /** This invoice's primary site's billing mode — see InvoiceBillingMode's doc comment. Each
   *  additional site combined onto this invoice (additionalSiteBills below) carries its own,
   *  independent mode instead. Absent/'headcount' on every invoice saved before this feature
   *  existed. */
  billingMode?: InvoiceBillingMode;
  lineGroups: InvoiceLineGroup[];
  /** Equipment/add-on rows (e-bikes, drones, etc.) billed on this invoice — see
   *  InvoiceEquipmentRow's doc comment. Absent/empty on invoices saved before this feature
   *  existed, and on any invoice that never had equipment added to it. */
  equipmentRows?: InvoiceEquipmentRow[];
  /** Extra sites combined into this same invoice beyond the primary one described by the
   *  top-level siteId/siteName/lineGroups/equipmentRows — see InvoiceSiteBill's doc comment.
   *  Absent/empty on every single-site invoice (still the default/common case). */
  additionalSiteBills?: InvoiceSiteBill[];
  subTotal: number;
  sstRate: number;
  sstAmount: number;
  total: number;
  status: InvoiceStatus;
  amountPaid: number;
  paidDate?: string;
  /** History of individual payments recorded against this invoice — see InvoicePayment's doc
   *  comment. Absent/empty on invoices created before this feature, or ones never marked as
   *  (partially) paid. */
  paymentLog?: InvoicePayment[];
  /** Snapshot of the Duty Roster reconciliation discrepancy at the moment this invoice was
   *  generated — the confirmed roster total minus what was actually billed in the line items
   *  (see InvoiceGenerator's remainingAmount/hasDiscrepancy). Null when there was nothing
   *  confirmed on Duty Roster to compare against for that site/month. Purely informational, fed
   *  into the Revenue tab's discrepancy rollup — never affects amountPaid/total. */
  discrepancyAmount?: number | null;
  /** Whether a discrepancy (see discrepancyAmount) was explicitly acknowledged before this
   *  invoice was generated anyway — see InvoiceGenerator's discrepancyAcknowledged checkbox. */
  discrepancyAcknowledged?: boolean;
  /** Copied from the site's Branch at the moment this invoice was generated — see Branch's doc
   *  comment. Snapshotted (not looked up live) so editing a branch's signatory later never
   *  changes how an already-issued invoice prints. */
  signatoryName?: string;
  signatoryTitle?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  /** Same meaning and lifecycle as Tender.isTestData — see its doc comment. */
  isTestData?: boolean;
  /** True only for a historical invoice entered via "Add historical invoice" (Branch Collection >
   *  Generate Invoice) to migrate a paper/legacy record into the app — one tied to an Active
   *  Project (tenderId) instead of a Duty Roster site, with a manually-typed invoiceNo rather
   *  than one assigned by the running counter. See createMigratedInvoice() in services/invoices.ts.
   *  Absent (not false) on every normal invoice. */
  isMigrated?: boolean;
  /** Set only when status === 'void' — see voidInvoice() in services/invoices.ts. Preserved
   *  indefinitely as the audit trail for why a wrongly-generated invoice was cancelled instead of
   *  deleted. */
  voidedAt?: number;
  voidedByUid?: string;
  voidedByName?: string;
  voidReason?: string;
}

// ---- Task Board (Branch Manager -> Operation Staff task assignment) ----

export type TaskPriority = 'High' | 'Medium' | 'Low';

/** One entry in a task's progress log — see addProgressUpdate() in services/tasks.ts. Entries
 *  are append-only (arrayUnion), so this doubles as the full history: nothing is ever edited
 *  or removed once posted, by either the assignee or the manager/admin who can also post. */
export interface TaskProgressUpdate {
  text: string;
  byUid: string;
  byName: string;
  at: number;
}

/**
 * A single work item a Branch Manager (or admin) assigns to one of their own Operation Staff —
 * see TaskBoardPage.tsx. Status flow:
 *   'open'           -> assigned, the assignee hasn't marked it done yet.
 *   'staffCompleted' -> the assignee clicked "Mark as done" (stamping staffCompletedAt); still
 *                        waiting on the manager to confirm via closeTask() in services/tasks.ts.
 *   'closed'         -> the manager confirmed it via the "Close Task" button (stamping closedAt).
 *                        Only a 'closed' task with closedAt in the CURRENT calendar month counts
 *                        toward the Completed stat tile/list — see isThisMonth() in
 *                        TaskBoardPage.tsx. A manager can also send a 'staffCompleted' task back
 *                        to 'open' via reopenTask() if the work wasn't actually done.
 * 'open' and 'staffCompleted' both count as still-outstanding ("Open") for the stat tiles — they
 * never disappear or reset on their own; only a genuinely 'closed' task ever leaves the Open
 * count, and only once a manager has confirmed it.
 */
export interface StaffTask {
  id: string;
  title: string;
  /** Free-form extra detail — optional, unlike title. */
  description?: string;
  /** Same branch name as the assignee's own UserProfile.department at the moment the task was
   *  created — denormalized here so firestore.rules and every client query can scope by branch
   *  without an extra doc read per task. */
  department: string;
  assigneeUid: string;
  assigneeName: string;
  priority: TaskPriority;
  status: 'open' | 'staffCompleted' | 'closed';
  createdAt: number;
  createdByUid: string;
  createdByName: string;
  /** Set by the assignee themselves when they mark the task done (see markTaskDone() in
   *  services/tasks.ts) — this is the "Close Date" shown in the task list. Cleared back to null
   *  if the manager reopens the task via reopenTask(). */
  staffCompletedAt: number | null;
  /** Set by the Branch Manager/admin confirming completion (see closeTask() in
   *  services/tasks.ts) — the date used for the Completed stat tile/list's monthly window. */
  closedAt: number | null;
  closedByName: string | null;
  /** Append-only progress log, oldest first — see TaskProgressUpdate and addProgressUpdate() in
   *  services/tasks.ts. Either the assignee or a manager/admin can post an entry, any time
   *  before the task is 'closed'. Always present (created as [] in assignTask()). */
  progressUpdates: TaskProgressUpdate[];
  /** Same meaning and lifecycle as Tender.isTestData — see its doc comment. */
  isTestData?: boolean;
}
