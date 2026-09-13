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
export type Role = 'admin' | 'branchManager' | 'dutyStaff' | 'payroll' | 'developer';

/**
 * True for any role that should get full administrative access throughout the app — currently
 * 'admin' and 'developer'. 'developer' exists purely so the account owner can sign in as a
 * dedicated testing account with the exact same access as a real admin, while every record it
 * creates gets auto-tagged isTestData: true (see shouldStampTestData() in services/settings.ts —
 * purely role-based, not tied to any shared/global setting) — so testing under this role can
 * never get mixed up with genuine data real staff/admin accounts create at the same time.
 * Always use this helper instead of comparing `role === 'admin'` directly, so a developer
 * account is never accidentally left out of an admin-gated check.
 */
export function isAdminRole(role: Role | string | undefined | null): boolean {
  return role === 'admin' || role === 'developer';
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

/** One row within an invoice line group — one guard category's headcount/days/rate for one
 *  location. `amount` is computed as headcount * days * 12 (a 12-hour shift) * rate and stored
 *  alongside the inputs so a saved invoice's total never silently drifts if the formula changes
 *  later. */
export interface InvoiceLineRow {
  category: string;
  headcount: number;
  days: number;
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

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid';

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
  lineGroups: InvoiceLineGroup[];
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
}
