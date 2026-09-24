import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { shouldStampTestData } from './settings';
import { getReachableSites } from './reachableSites';
import type { Invoice, InvoiceBillingMode, InvoiceEquipmentRow, InvoiceLineGroup, InvoiceSiteBill, InvoiceStatus, Role, SiteBillingRate, UserProfile } from '../types';

function invoicesCollection() {
  return collection(db, 'invoices');
}

/** Hours-per-shift baked into every invoice line's amount — see InvoiceLineRow's doc comment in
 *  types.ts. A 12-hour shift is what the sample invoices this feature was built from use; pulled
 *  out as a constant so it's the one place to change if a future contract uses a different one. */
export const INVOICE_HOURS_PER_SHIFT = 12;

/**
 * Canonical category name for a temporary extra guard post the client asked for beyond a site's
 * normally configured guard-post count (Duty Roster > Guards & Shifts' Client Site Requirement —
 * see BillingSite.guardCount's doc comment in services/siteBilling.ts). Billed exactly like any
 * other SiteBillingRate category — headcount/days/rate, added as a line row the same way — but
 * see isAdditionalGuardCategory() below for the one thing that's different about it: it's
 * deliberately exempt from InvoiceGenerator's headcountExceedsSite hard cap, since by definition
 * it's ABOVE the site's contracted post count, not one of the normal posts that cap protects.
 */
export const ADDITIONAL_GUARD_CATEGORY = 'Additional Guard (Temporary)';

/** Whether a line row's category is the special Additional Guard (Temporary) one above — matched
 *  case-insensitively (and trimmed) so a category typed with different casing, e.g. because it
 *  was saved on the site's billingRates before this constant's exact casing was settled on,
 *  still gets recognized. Used to exclude that row's headcount from the site's normal guard-post
 *  cap — see headcountExceedsSite/remainingHeadcountFor in InvoiceGenerator.tsx. */
export function isAdditionalGuardCategory(category: string): boolean {
  return category.trim().toLowerCase() === ADDITIONAL_GUARD_CATEGORY.toLowerCase();
}

/** Rounds to the nearest cent. Money math in floating point (subTotal * sstRate, in particular)
 *  routinely lands a fraction of a cent off a "clean" 2-decimal figure — e.g. 1656 * 0.08 can come
 *  out as 132.48000000000002 instead of exactly 132.48 — so sstAmount/total are always rounded
 *  before being stored, rather than persisting whatever a float multiplication happened to
 *  produce. deriveInvoiceStatus below also tolerates a small remainder on top of this, as a
 *  safety net for invoices saved before this rounding existed. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** headcount * days * 12-hour shift * hourly rate — the exact formula the sample invoices this
 *  feature was modeled on come out to. Centralized so the generator form and any future edit
 *  flow compute a saved invoice's line amount identically. */
export function computeLineAmount(headcount: number, days: number, rate: number): number {
  return headcount * days * INVOICE_HOURS_PER_SHIFT * rate;
}

/** manHours * rate directly — the 'manhour' InvoiceBillingMode's formula (see its doc comment
 *  in types.ts), used instead of computeLineAmount() above for a site whose line items are
 *  billed by actual man-hours rather than headcount * days * a fixed 12-hour shift. */
export function computeManHourLineAmount(manHours: number, rate: number): number {
  return manHours * rate;
}

export function sumLineGroups(lineGroups: InvoiceLineGroup[]): number {
  return lineGroups.reduce(
    (sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + row.amount, 0),
    0
  );
}

/** quantity * monthlyRate for every equipment/add-on row — see InvoiceEquipmentRow's doc
 *  comment in types.ts. Kept as its own function (rather than folded into sumLineGroups) since
 *  equipment rows are a separate flat list, not nested inside lineGroups' location grouping. */
export function sumEquipmentRows(equipmentRows: InvoiceEquipmentRow[] | undefined): number {
  return (equipmentRows || []).reduce((sum, row) => sum + row.amount, 0);
}

/** Derives this invoice's billing rate categories straight from a tender's (or a site's own
 *  siteDetails override's) Guard Rate setup (Active Projects > Project Details — see
 *  Tender.guardRateMode's doc comment in types.ts), so the same rate never has to be typed once
 *  there and again on an invoice. 'multiple' mode maps each named position directly to a
 *  category of the same name/rate; 'same' mode has no position names to draw from, so it becomes
 *  a single "Security Guard" category at the flat rate. Returns null when there's no Guard Rate
 *  configured yet (undefined mode, or a 'same' rate of 0) — callers fall back to the site's own
 *  saved billingRates in that case, so a project that hasn't set one up yet keeps working exactly
 *  as before. Exported (moved here from InvoiceGenerator.tsx) so InvoiceSiteSection.tsx — an
 *  additional site's billing section within a combined invoice — can derive its own site's rates
 *  the same way without importing back from InvoiceGenerator.tsx. */
export function deriveRateCategoriesFromGuardRate(t: {
  guardRateMode?: 'same' | 'multiple';
  guardRate?: number;
  guardRatePositions?: { name: string; rate: number }[];
}): SiteBillingRate[] | null {
  if (t.guardRateMode === 'multiple') {
    const positions = (t.guardRatePositions || []).filter((p) => p.name.trim());
    return positions.length > 0
      ? positions.map((p) => ({ category: p.name, hourlyRate: p.rate }))
      : null;
  }
  if (t.guardRateMode === 'same' && t.guardRate) {
    return [{ category: 'Security Guard', hourlyRate: t.guardRate }];
  }
  return null;
}

/** One site's share of a combined invoice's revenue — see getInvoiceSiteAllocations() below. */
export interface InvoiceSiteAllocation {
  siteId: string | null;
  siteName: string;
  amount: number;
}

/**
 * Splits one invoice's `total` (SST included) across every site it billed — see combined
 * invoicing (Invoice.additionalSiteBills in types.ts) — proportional to each site's own share of
 * the invoice's pre-SST subTotal, so the allocations for one invoice always sum back to exactly
 * its own `total` (SST is a flow-through tax, not itself tied to any one site, so it's spread the
 * same way the underlying revenue is; each site's own pre-SST subTotal is exact — see
 * InvoiceSiteBill's doc comment — only the SST slice is prorated). A normal single-site invoice
 * (no additionalSiteBills, still the common case) allocates its whole total to its one site,
 * unchanged from before this feature existed. Used by the Revenue tab's per-site breakdown.
 */
export function getInvoiceSiteAllocations(inv: Invoice): InvoiceSiteAllocation[] {
  const additional = inv.additionalSiteBills || [];
  if (additional.length === 0) {
    return [{ siteId: inv.siteId, siteName: inv.siteName, amount: inv.total }];
  }
  if (inv.subTotal === 0) {
    // Nothing to prorate by (a zero-value invoice, or a data anomaly) — attribute the whole
    // (zero) total to the primary site rather than dividing by zero.
    return [{ siteId: inv.siteId, siteName: inv.siteName, amount: inv.total }];
  }
  const additionalSubTotal = additional.reduce((sum, b) => sum + b.subTotal, 0);
  const primarySubTotal = inv.subTotal - additionalSubTotal;
  const bills = [
    { siteId: inv.siteId, siteName: inv.siteName, subTotal: primarySubTotal },
    ...additional.map((b) => ({ siteId: b.siteId, siteName: b.siteName, subTotal: b.subTotal })),
  ];
  return bills.map((b) => ({ siteId: b.siteId, siteName: b.siteName, amount: (b.subTotal / inv.subTotal) * inv.total }));
}

/**
 * Invoice numbers auto-generate as CODE/CODE/CODE/YEAR/RUNNING — e.g. "PZ/KV2/MDEC/2026/05" —
 * from three short codes (Brand.shortCode, Branch.shortCode, Tender.clientAlias), the invoice's
 * own year, and a running sequence. Turns whatever a short code happens to be (a saved nickname,
 * or a fallback to the full name) into something safe to print and to use as part of a Firestore
 * document ID: uppercased, trimmed, internal whitespace/punctuation collapsed to single hyphens,
 * capped at 20 chars so a long fallback name doesn't produce an unwieldy number.
 */
export function sanitizeInvoiceCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20) || 'X';
}

/** The Firestore doc ID (under /invoiceCounters) backing one brand+branch+client's running
 *  sequence. Deliberately excludes the year — see createInvoice's doc comment on why the
 *  sequence itself never resets, even though the year segment printed next to it does. */
export function buildInvoiceCounterKey(brandCode: string, branchCode: string, clientAlias: string): string {
  return [brandCode, branchCode, clientAlias].map(sanitizeInvoiceCode).join('__');
}

export function formatInvoiceNumber(
  brandCode: string,
  branchCode: string,
  clientAlias: string,
  year: number,
  seq: number
): string {
  return `${sanitizeInvoiceCode(brandCode)}/${sanitizeInvoiceCode(branchCode)}/${sanitizeInvoiceCode(clientAlias)}/${year}/${String(seq).padStart(2, '0')}`;
}

/** Read-only look at what the NEXT invoice number for this brand+branch+client would be, for
 *  display while filling out the generator — does not reserve or increment anything, so it's
 *  safe to call on every keystroke/selection change. The actual number is only assigned (and the
 *  counter only incremented) inside createInvoice()'s transaction at save time, so if two
 *  invoices for the same combination are being drafted at once, whichever saves first gets the
 *  number shown here and the other's preview would have been off by one — normal optimistic-UI
 *  behavior, not a bug. */
export async function peekNextInvoiceNumber(
  brandCode: string,
  branchCode: string,
  clientAlias: string,
  year: number
): Promise<string> {
  const key = buildInvoiceCounterKey(brandCode, branchCode, clientAlias);
  const snap = await getDoc(doc(db, 'invoiceCounters', key));
  const last = snap.exists() ? (snap.data().lastNumber as number) || 0 : 0;
  return formatInvoiceNumber(brandCode, branchCode, clientAlias, year, last + 1);
}

export interface NewInvoiceInput {
  brandId: string;
  brandName: string;
  brandCode: string;
  branchId: string | null;
  branchName: string;
  siteId: string | null;
  siteName: string;
  tenderId: string | null;
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  branchCode: string;
  clientAlias: string;
  invoiceDate: string;
  billingMonth: string;
  billingMonthKey: string;
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  /** This invoice's primary site's billing mode — see InvoiceBillingMode's doc comment in
   *  types.ts. Defaults to 'headcount' when omitted, the original behavior. */
  billingMode?: InvoiceBillingMode;
  lineGroups: InvoiceLineGroup[];
  equipmentRows?: InvoiceEquipmentRow[];
  /** Extra sites combined into this same invoice beyond the primary one described by
   *  siteId/siteName/lineGroups/equipmentRows above — see InvoiceSiteBill's doc comment in
   *  types.ts. Each entry's subTotal is computed here in createInvoice(), the same way the
   *  invoice's own overall subTotal is, so callers only need to supply lineGroups/equipmentRows
   *  per additional site. Absent/empty for a normal single-site invoice. */
  additionalSiteBills?: { siteId: string; siteName: string; lineGroups: InvoiceLineGroup[]; equipmentRows: InvoiceEquipmentRow[]; billingMode?: InvoiceBillingMode }[];
  sstRate: number;
  signatoryName?: string;
  signatoryTitle?: string;
  discrepancyAmount: number | null;
  discrepancyAcknowledged: boolean;
}

/** Actor performing the create — same shape as createTender's Actor (src/services/tenders.ts),
 *  so a developer account's invoices are tagged isTestData the same way everything else is. */
type Actor = { uid: string; name: string; role?: Role };

/**
 * Creates an invoice AND assigns its number in one atomic transaction: reads the
 * /invoiceCounters doc for this exact brand+branch+client combination, increments it, and writes
 * the new invoice with the resulting number — so two invoices for the same combination can never
 * come out with the same number even if saved at nearly the same moment. The YEAR segment comes
 * from `invoiceDate` and is just whatever year that invoice is dated; the RUNNING segment is the
 * one thing that never resets (see buildInvoiceCounterKey not including year) — per the decision
 * this was built from, a brand+branch+client's sequence counts up forever across years rather
 * than restarting at 01 each January.
 */
export async function createInvoice(input: NewInvoiceInput, actor: Actor): Promise<{ id: string; invoiceNo: string }> {
  const now = Date.now();
  const additionalBills: InvoiceSiteBill[] = (input.additionalSiteBills || []).map((b) => ({
    siteId: b.siteId,
    siteName: b.siteName,
    lineGroups: b.lineGroups || [],
    equipmentRows: b.equipmentRows || [],
    billingMode: b.billingMode || 'headcount',
    subTotal: sumLineGroups(b.lineGroups) + sumEquipmentRows(b.equipmentRows),
  }));
  const subTotal =
    sumLineGroups(input.lineGroups) +
    sumEquipmentRows(input.equipmentRows) +
    additionalBills.reduce((sum, b) => sum + b.subTotal, 0);
  const sstAmount = roundMoney(subTotal * input.sstRate);
  const total = roundMoney(subTotal + sstAmount);
  const isTestData = await shouldStampTestData(actor.role);
  const year = new Date(`${input.invoiceDate}T00:00:00`).getFullYear() || new Date().getFullYear();
  const counterKey = buildInvoiceCounterKey(input.brandCode, input.branchCode, input.clientAlias);

  const newInvoiceRef = doc(invoicesCollection());
  const counterRef = doc(db, 'invoiceCounters', counterKey);

  const invoiceNo = await runTransaction(db, async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const last = counterSnap.exists() ? (counterSnap.data().lastNumber as number) || 0 : 0;
    const seq = last + 1;
    const number = formatInvoiceNumber(input.brandCode, input.branchCode, input.clientAlias, year, seq);

    tx.set(
      counterRef,
      {
        lastNumber: seq,
        brandCode: input.brandCode,
        branchCode: input.branchCode,
        clientAlias: input.clientAlias,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(newInvoiceRef, {
      brandId: input.brandId,
      brandName: input.brandName,
      branchId: input.branchId,
      branchName: input.branchName,
      siteId: input.siteId,
      siteName: input.siteName,
      tenderId: input.tenderId,
      clientName: input.clientName,
      clientAddress: input.clientAddress || '',
      attnName: input.attnName || '',
      invoiceNo: number,
      invoiceDate: input.invoiceDate,
      billingMonth: input.billingMonth,
      billingMonthKey: input.billingMonthKey,
      contractRef: input.contractRef || '',
      quotationNo: input.quotationNo || '',
      paymentTermsDays: input.paymentTermsDays,
      billingMode: input.billingMode || 'headcount',
      lineGroups: input.lineGroups,
      equipmentRows: input.equipmentRows || [],
      additionalSiteBills: additionalBills,
      signatoryName: input.signatoryName || '',
      signatoryTitle: input.signatoryTitle || '',
      subTotal,
      sstRate: input.sstRate,
      sstAmount,
      total,
      status: 'unpaid' as InvoiceStatus,
      amountPaid: 0,
      paymentLog: [],
      discrepancyAmount: input.discrepancyAmount,
      discrepancyAcknowledged: input.discrepancyAcknowledged,
      createdByUid: actor.uid,
      createdByName: actor.name,
      createdAt: now,
      updatedAt: now,
      isTestData,
    });

    return number;
  });

  return { id: newInvoiceRef.id, invoiceNo };
}

export interface NewMigratedInvoiceInput {
  brandId: string;
  brandName: string;
  brandCode: string;
  branchId: string | null;
  branchName: string;
  branchCode: string;
  tenderId: string | null;
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  clientAlias: string;
  invoiceNo: string;
  invoiceDate: string;
  billingMonth: string;
  billingMonthKey: string;
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  subTotal: number;
  sstRate: number;
  /** Clamped to [0, total] and used to derive `status` automatically — see deriveInvoiceStatus/
   *  clampAmountPaid — rather than trusting a status picked independently of the amount. */
  amountPaid: number;
  paidDate?: string;
  /** When set to a value greater than the brand+branch+client counter's current lastNumber,
   *  bumps the counter up to it in the same write — see createMigratedInvoice's doc comment for
   *  why this exists. Leave unset/0 to not touch the counter at all. */
  reserveRunningNumber?: number | null;
}

/**
 * Records a historical invoice that was already issued to a client before this app existed (or
 * outside its normal Duty Roster-driven flow) — tied to an Active Project (tenderId) instead of a
 * Duty Roster site, since siteId is always null here. Unlike createInvoice(), invoiceNo is
 * exactly what the caller supplies (the number already printed on the original document) rather
 * than assigned from the running counter, and subTotal/status/amountPaid are entered directly
 * instead of derived from line items — a single synthetic line item is stored purely so the
 * invoice still prints sensibly if ever viewed.
 *
 * Because the counter never issued this invoiceNo, left alone it has no way to know a running
 * number this high is already "used" — the very next NORMAL invoice for the same
 * brand+branch+client could then reuse a running number a migrated invoice's own number already
 * carries. When the caller supplies `reserveRunningNumber` (see MigrateInvoiceForm's
 * guessRunningNumber — best-effort parsed from the tail of the typed invoiceNo, editable), the
 * counter is bumped up to at least that value in the same transaction as the invoice write, so
 * future auto-numbering continues on from the highest known historical number instead of
 * eventually repeating one.
 */
export async function createMigratedInvoice(input: NewMigratedInvoiceInput, actor: Actor): Promise<{ id: string }> {
  const now = Date.now();
  const subTotal = input.subTotal;
  const sstAmount = roundMoney(subTotal * input.sstRate);
  const total = roundMoney(subTotal + sstAmount);
  const amountPaid = clampAmountPaid(input.amountPaid, total);
  const status = deriveInvoiceStatus(amountPaid, total);
  const isTestData = await shouldStampTestData(actor.role);

  const lineGroups: InvoiceLineGroup[] = [
    {
      location: 'Migrated invoice',
      rows: [
        {
          category: 'Total carried over from historical record',
          headcount: 1,
          days: 1,
          rate: subTotal,
          amount: subTotal,
        },
      ],
    },
  ];

  const newInvoiceRef = doc(invoicesCollection());
  const paymentLog =
    amountPaid > 0
      ? [
          {
            amount: amountPaid,
            date: input.paidDate || input.invoiceDate,
            recordedAt: now,
            recordedByUid: actor.uid,
            recordedByName: actor.name,
          },
        ]
      : [];

  const invoiceData = {
    brandId: input.brandId,
    brandName: input.brandName,
    branchId: input.branchId,
    branchName: input.branchName,
    siteId: null,
    siteName: '',
    tenderId: input.tenderId,
    clientName: input.clientName,
    clientAddress: input.clientAddress || '',
    attnName: input.attnName || '',
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    billingMonth: input.billingMonth,
    billingMonthKey: input.billingMonthKey,
    contractRef: input.contractRef || '',
    quotationNo: input.quotationNo || '',
    paymentTermsDays: input.paymentTermsDays,
    lineGroups,
    subTotal,
    sstRate: input.sstRate,
    sstAmount,
    total,
    status,
    amountPaid,
    paidDate: amountPaid > 0 ? input.paidDate || null : null,
    paymentLog,
    discrepancyAmount: null,
    discrepancyAcknowledged: true,
    createdByUid: actor.uid,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
    isTestData,
    isMigrated: true,
  };

  if (input.reserveRunningNumber && input.reserveRunningNumber > 0) {
    const counterKey = buildInvoiceCounterKey(input.brandCode, input.branchCode, input.clientAlias);
    const counterRef = doc(db, 'invoiceCounters', counterKey);
    const reserve = input.reserveRunningNumber;
    await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const current = counterSnap.exists() ? (counterSnap.data().lastNumber as number) || 0 : 0;
      if (reserve > current) {
        tx.set(
          counterRef,
          {
            lastNumber: reserve,
            brandCode: input.brandCode,
            branchCode: input.branchCode,
            clientAlias: input.clientAlias,
            updatedAt: now,
          },
          { merge: true }
        );
      }
      tx.set(newInvoiceRef, invoiceData);
    });
  } else {
    await setDoc(newInvoiceRef, invoiceData);
  }

  return { id: newInvoiceRef.id };
}

/**
 * Subscribes to every invoice this viewer is allowed to see — matches firestore.rules' /invoices
 * read rule exactly: Admin/Developer/CEO/Director/Tender Controller and Finance see every branch
 * unscoped, while a Branch Manager or Operation Admin only ever sees their OWN branch's invoices
 * (`where('branchName', '==', profile.department)`), same as everywhere else in this app scopes a
 * Branch Manager to their own department (see isTaskManager() in firestore.rules for the same
 * pattern). `profile` is optional only so a stray caller that forgets it fails open to the old
 * unscoped behavior rather than crashing — every real call site (InvoiceList/DebtorList/
 * RevenuePanel) passes the signed-in profile from useAuth().
 *
 * Deliberately does NOT combine the branch `where` with `orderBy('createdAt', 'desc')` — Cloud
 * Firestore would require a composite index for that pair, which can't be created from outside
 * the Firebase console, so this sorts the snapshot client-side instead (same output, no index
 * needed) — see useTasks.ts's own doc comment for the matching lesson on why a security rule that
 * depends on resource.data needs the QUERY itself to filter on that field, not just the rule.
 */
export function subscribeInvoices(callback: (invoices: Invoice[]) => void, profile?: UserProfile | null): () => void {
  const branchScope =
    (profile?.role === 'branchManager' || profile?.role === 'operationAdmin') && profile.department
      ? profile.department
      : null;
  const q = branchScope ? query(invoicesCollection(), where('branchName', '==', branchScope)) : invoicesCollection();
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invoice, 'id'>) }));
    rows.sort((a, b) => b.createdAt - a.createdAt);
    callback(rows);
  });
}

/** Unpaid once nothing's been paid, Paid once amountPaid reaches the invoice's total (or would
 *  exceed it — see clampAmountPaid, which is always applied first), Partially Paid anywhere in
 *  between. The single source of truth for an invoice's status — it's never set independently of
 *  amountPaid, so "Paid" and "there's still a balance owing" can never disagree with each other. */
// Half a cent — comfortably bigger than any float-multiplication remainder (see roundMoney),
// comfortably smaller than a real outstanding amount, so it can never mask an actual partial
// payment while still treating "paid in full down to the cent" as fully paid regardless of
// which side of a cent a leftover float fraction happens to fall on.
const AMOUNT_EPSILON = 0.005;

export function deriveInvoiceStatus(amountPaid: number, total: number): InvoiceStatus {
  if (amountPaid <= 0) return 'unpaid';
  if (total <= 0 || amountPaid >= total - AMOUNT_EPSILON) return 'paid';
  return 'partial';
}

/** Keeps a recorded payment from ever overshooting what's actually owed on the invoice — clamps
 *  to the [0, total] range (a negative or NaN input clamps to 0). */
export function clampAmountPaid(amountPaid: number, total: number): number {
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return 0;
  return Math.min(amountPaid, Math.max(total, 0));
}

/**
 * Updates an invoice's payment status. `previousAmountPaid` is the amountPaid the invoice had
 * before this edit (the caller already has the Invoice loaded, so no extra read here) — the
 * difference between it and the (clamped) new amountPaid is what gets appended to paymentLog as
 * one installment, so a running history of payments survives even though amountPaid itself is
 * only ever the latest cumulative total. A save that doesn't actually move the amount logs
 * nothing — the log is a record of real payments, not of edits.
 *
 * `status` is always derived from amountPaid vs `total` (see deriveInvoiceStatus) rather than
 * chosen independently, and amountPaid is always clamped to never exceed `total` (see
 * clampAmountPaid) — so a payment can never overshoot what's owed, and the status can never
 * disagree with the actual remaining balance.
 */
export async function updateInvoiceStatus(
  id: string,
  patch: { amountPaid: number; total: number; paidDate?: string; previousAmountPaid: number },
  actor: { uid: string; name: string }
): Promise<void> {
  const amountPaid = clampAmountPaid(patch.amountPaid, patch.total);
  const status = deriveInvoiceStatus(amountPaid, patch.total);
  const delta = amountPaid - patch.previousAmountPaid;
  const updates: Record<string, unknown> = {
    status,
    amountPaid,
    paidDate: patch.paidDate || null,
    updatedAt: Date.now(),
  };
  if (delta !== 0) {
    updates.paymentLog = arrayUnion({
      amount: delta,
      date: patch.paidDate || new Date().toISOString().slice(0, 10),
      recordedAt: Date.now(),
      recordedByUid: actor.uid,
      recordedByName: actor.name,
    });
  }
  await updateDoc(doc(db, 'invoices', id), updates);
}

/**
 * Cancels a wrongly-generated invoice in place — sets status to 'void' and records who/when/why,
 * but never deletes the doc or touches invoiceNo/lineGroups/total, so the invoice's number stays
 * spent (numbering is never reused/reset — see buildInvoiceCounterKey's doc comment) and the
 * original figures remain on record for audit purposes. A voided invoice is excluded from the
 * Debtor List's outstanding figures and the Revenue tab's totals (see their own `filtered`
 * memos), can't be voided again, and can no longer have its content edited or a payment recorded
 * (see updateInvoiceContent()/updateInvoiceStatus() and firestore.rules' financeUpdateOnlyTouches
 * for how that's enforced for a Finance-role account; Admin/Branch Manager are trusted to check
 * an invoice's current status client-side before calling either).
 */
export async function voidInvoice(
  id: string,
  reason: string,
  actor: { uid: string; name: string }
): Promise<void> {
  await updateDoc(doc(db, 'invoices', id), {
    status: 'void',
    voidedAt: Date.now(),
    voidedByUid: actor.uid,
    voidedByName: actor.name,
    voidReason: reason.trim(),
    updatedAt: Date.now(),
  });
}

/** Fields a "limited edit" of an already-saved invoice may change — deliberately excludes
 *  invoiceNo (numbering is never renumbered after the fact), brandId/siteId/tenderId (those pick
 *  which letterhead/counter the invoice belongs to, not something a correction should move), and
 *  billingMonth/billingMonthKey (which month's Revenue rollup this counts toward). Everything
 *  else that can be wrong on a freshly-generated invoice — client details, dates, references, and
 *  the line items themselves — is here. */
export interface InvoiceEditInput {
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  invoiceDate: string;
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  sstRate: number;
  /** This invoice's primary site's billing mode — see InvoiceBillingMode's doc comment in
   *  types.ts. Editable here like the line items themselves; additionalSiteBills (combined-
   *  invoice sites) are excluded from this limited edit entirely, same as lineGroups. */
  billingMode?: InvoiceBillingMode;
  lineGroups: InvoiceLineGroup[];
  equipmentRows?: InvoiceEquipmentRow[];
}

/**
 * Applies a limited content edit to an already-saved invoice, recomputing subTotal/sstAmount/
 * total from the edited line items exactly the way createInvoice() derives them the first time
 * (see sumLineGroups/roundMoney) so an edited invoice's totals never drift from what its own line
 * items add up to. Callers are expected to only offer this for an invoice that's still 'unpaid'
 * and not 'void' (see InvoiceList's Edit gating) — enforced there rather than here/in rules,
 * since by the time an Admin/Branch Manager reaches this function they're already trusted with
 * the invoice's full content, same as at creation time.
 */
export async function updateInvoiceContent(id: string, input: InvoiceEditInput): Promise<void> {
  const subTotal = roundMoney(sumLineGroups(input.lineGroups) + sumEquipmentRows(input.equipmentRows));
  const sstAmount = roundMoney(subTotal * input.sstRate);
  const total = roundMoney(subTotal + sstAmount);
  await updateDoc(doc(db, 'invoices', id), {
    clientName: input.clientName.trim(),
    clientAddress: input.clientAddress?.trim() || '',
    attnName: input.attnName?.trim() || '',
    invoiceDate: input.invoiceDate,
    contractRef: input.contractRef?.trim() || '',
    quotationNo: input.quotationNo?.trim() || '',
    paymentTermsDays: input.paymentTermsDays,
    sstRate: input.sstRate,
    billingMode: input.billingMode || 'headcount',
    lineGroups: input.lineGroups,
    equipmentRows: input.equipmentRows || [],
    subTotal,
    sstAmount,
    total,
    updatedAt: Date.now(),
  });
}

export interface BackfillBranchResult {
  total: number;
  updated: number;
  skippedNoSite: number;
  /** Of `updated`, how many got a branchName filled in but no branchId (the site's branch name
   *  didn't match any current Branch record) — still won't surface under a branch filter, same
   *  as a brand-new invoice would behave in that situation. */
  updatedNameOnly: number;
}

/**
 * One-time data fix for invoices saved before branchId/branchName existed on the Invoice doc
 * (added alongside the Debtor List's branch filter) — without it, an older invoice silently
 * drops out of any branch-filtered view (Revenue tab, Debtor List) even though "All branches"
 * still shows it fine, since only the branchId equality check excludes it.
 *
 * For every invoice missing branchId, looks up its siteId in the Duty Roster `sites` collection
 * to read that site's `branch` name, then matches it against the `branches` collection the same
 * way InvoiceGenerator does for new invoices (see matchedBranch there). Invoices with no siteId,
 * or whose site's branch name doesn't match any current Branch record, get branchName set from
 * the site's raw branch string where available (for display) but branchId stays unset — same as
 * how a new invoice behaves in that situation, so branch-filtering still won't surface them, but
 * nothing about them looks broken either. Never touches an invoice that already has a branchId.
 */
/** Trims and lowercases a branch/site name so "KV3 Branch", " KV3 Branch ", and "kv3 branch"
 *  all match each other — names entered by hand in two different collections drift like this
 *  more often than it seems. */
function normalizeBranchName(name: string): string {
  return name.trim().toLowerCase();
}

/** Builds the two lookup maps `backfillInvoiceBranches` and `diagnoseInvoiceBranches` both need:
 *  siteId -> that site's raw branch name string, and normalized branch name -> {id, name} of the
 *  matching Branch record (matching case/whitespace-insensitively; see `normalizeBranchName`).
 *
 *  /sites LIST must be scoped to what this profile can actually read — an unfiltered
 *  `getDocs(collection(db, 'sites'))` is permission-denied for a Branch Manager (same
 *  resource.data.branch rule as useSiteList / subscribeReachableSites). */
async function loadSiteAndBranchLookups(profile: UserProfile) {
  const [siteDocs, branchesSnap] = await Promise.all([
    getReachableSites(profile),
    getDocs(collection(db, 'branches')),
  ]);

  const siteBranchById = new Map<string, string>();
  siteDocs.forEach((d) => {
    const branch = (d.data() as { branch?: string }).branch;
    if (branch) siteBranchById.set(d.id, branch);
  });
  const branchByNormalizedName = new Map<string, { id: string; name: string }>();
  branchesSnap.forEach((d) => {
    const name = (d.data() as { name?: string }).name;
    if (name) branchByNormalizedName.set(normalizeBranchName(name), { id: d.id, name });
  });

  return { siteBranchById, branchByNormalizedName };
}

export async function backfillInvoiceBranches(profile: UserProfile): Promise<BackfillBranchResult> {
  const [invoicesSnap, { siteBranchById, branchByNormalizedName }] = await Promise.all([
    getDocs(invoicesCollection()),
    loadSiteAndBranchLookups(profile),
  ]);

  const result: BackfillBranchResult = { total: 0, updated: 0, skippedNoSite: 0, updatedNameOnly: 0 };
  let batch = writeBatch(db);
  let opsInBatch = 0;
  const commits: Promise<void>[] = [];

  for (const d of invoicesSnap.docs) {
    const inv = d.data() as Invoice;
    if (inv.branchId) continue; // already backfilled or created after branchId existed
    result.total++;

    const siteBranchName = inv.siteId ? siteBranchById.get(inv.siteId) : undefined;
    if (!siteBranchName) {
      result.skippedNoSite++;
      continue;
    }
    const matchedBranch = branchByNormalizedName.get(normalizeBranchName(siteBranchName));
    if (!matchedBranch) result.updatedNameOnly++;

    batch.update(d.ref, { branchId: matchedBranch?.id || null, branchName: matchedBranch?.name || siteBranchName });
    result.updated++;
    opsInBatch++;
    if (opsInBatch >= 400) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return result;
}

export interface InvoiceBranchDiagnostic {
  invoiceId: string;
  invoiceNo: string;
  siteId: string | null;
  siteName: string;
  branchName: string | null;
  reason: string;
}

/**
 * Read-only inspection of every invoice still missing a branchId, explaining exactly why the
 * match failed for each one — so a stuck invoice (still not showing under a branch filter after
 * running the backfill) can be diagnosed from the Revenue tab instead of guessing blind. Doesn't
 * write anything.
 */
export async function diagnoseInvoiceBranches(profile: UserProfile): Promise<InvoiceBranchDiagnostic[]> {
  const [invoicesSnap, { siteBranchById, branchByNormalizedName }] = await Promise.all([
    getDocs(invoicesCollection()),
    loadSiteAndBranchLookups(profile),
  ]);

  const rows: InvoiceBranchDiagnostic[] = [];
  invoicesSnap.forEach((d) => {
    const inv = d.data() as Invoice;
    if (inv.branchId) return; // already resolved

    let reason: string;
    if (!inv.siteId) {
      reason = 'No linked site on this invoice (siteId is empty)';
    } else {
      const siteBranchName = siteBranchById.get(inv.siteId);
      if (!siteBranchName) {
        reason = `Linked site (${inv.siteId}) has no branch assigned, or the site no longer exists`;
      } else {
        const matchedBranch = branchByNormalizedName.get(normalizeBranchName(siteBranchName));
        reason = matchedBranch
          ? 'Should be matched — try running the backfill again'
          : `Site's branch "${siteBranchName}" doesn't match any Branch record by name`;
      }
    }

    rows.push({
      invoiceId: d.id,
      invoiceNo: inv.invoiceNo,
      siteId: inv.siteId,
      siteName: inv.siteName,
      branchName: inv.branchName || null,
      reason,
    });
  });

  return rows;
}

export interface BackfillStatusResult {
  total: number;
  updated: number;
}

/**
 * One-time data fix for invoices whose stored `status` disagrees with what deriveInvoiceStatus
 * would compute from their own amountPaid/total — the fallout of two bugs fixed together: status
 * used to be picked independently of amountPaid (see updateInvoiceStatus's doc comment), and
 * totals computed before roundMoney existed can carry a fraction-of-a-cent float remainder that
 * used to make an invoice paid in full down to the cent get stuck showing Partially Paid forever
 * (see deriveInvoiceStatus's AMOUNT_EPSILON comment). Both are self-healing the next time an
 * invoice is resaved through the Status editor, but this fixes every affected invoice at once
 * rather than requiring each one to be opened by hand. Safe to run more than once — it only ever
 * touches invoices whose stored status doesn't match their own amount.
 *
 * Void invoices are left alone. deriveInvoiceStatus only returns unpaid/partial/paid (it has no
 * void input), so without this skip a cancelled invoice with amountPaid === 0 would be rewritten
 * to 'unpaid' and reappear on the Debtor List / Revenue totals.
 */
export async function backfillInvoiceStatuses(): Promise<BackfillStatusResult> {
  const invoicesSnap = await getDocs(invoicesCollection());

  const result: BackfillStatusResult = { total: invoicesSnap.size, updated: 0 };
  let batch = writeBatch(db);
  let opsInBatch = 0;
  const commits: Promise<void>[] = [];

  for (const d of invoicesSnap.docs) {
    const inv = d.data() as Invoice;
    if (inv.status === 'void') continue;
    const correctStatus = deriveInvoiceStatus(inv.amountPaid, inv.total);
    if (correctStatus === inv.status) continue;

    batch.update(d.ref, { status: correctStatus, updatedAt: Date.now() });
    result.updated++;
    opsInBatch++;
    if (opsInBatch >= 400) {
      commits.push(batch.commit());
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return result;
}

export interface OutstandingTrendPoint {
  /** yyyy-mm */
  monthKey: string;
  /** Total outstanding balance across every invoice, as of the end of this month. */
  outstanding: number;
}

/**
 * Reconstructs the total outstanding balance as of the end of every month, from the earliest
 * invoice on record to the current month, by replaying two kinds of dated events in chronological
 * order: an invoice's full total lands on its invoiceDate, and each recorded payment (see
 * InvoicePayment) reduces the balance on the date it was recorded — falling back to the invoice's
 * own paidDate (or invoiceDate if that's missing too) for an invoice saved before paymentLog
 * existed. A month with no events of its own carries the previous month's running total forward,
 * so the series is continuous rather than dropping to zero in the gaps — and its very last point
 * always equals exactly what the Debtor List's own "Total outstanding" figure shows right now,
 * since both ultimately add up to the same sum(total) - sum(amountPaid) underneath.
 */
export function computeOutstandingTrend(invoices: Invoice[]): OutstandingTrendPoint[] {
  if (invoices.length === 0) return [];

  const todayMonth = new Date().toISOString().slice(0, 7);
  const monthKeyOfDate = (iso: string | undefined): string => {
    const key = iso ? iso.slice(0, 7) : '';
    return /^\d{4}-\d{2}$/.test(key) ? key : todayMonth;
  };

  const events: { monthKey: string; delta: number }[] = [];
  for (const inv of invoices) {
    events.push({ monthKey: monthKeyOfDate(inv.invoiceDate), delta: inv.total });

    let loggedReduction = 0;
    if (inv.paymentLog && inv.paymentLog.length > 0) {
      for (const p of inv.paymentLog) {
        events.push({ monthKey: monthKeyOfDate(p.date || inv.invoiceDate), delta: -p.amount });
        loggedReduction += p.amount;
      }
    }

    // True up against the invoice's own authoritative amountPaid rather than trusting paymentLog
    // to fully account for it — a log built up across manual edits (e.g. before amounts were
    // clamped/derived) can under- or over-total the current amountPaid. Without this, the trend's
    // latest point can silently drift from the Debtor List's own live "Total outstanding" figure,
    // which is always computed directly as sum(total) - sum(amountPaid). Any shortfall/excess is
    // dated to the most recent known payment (or paidDate/invoiceDate if there's no log at all).
    const shortfall = inv.amountPaid - loggedReduction;
    if (Math.abs(shortfall) > 0.005) {
      const lastLoggedDate = inv.paymentLog && inv.paymentLog.length > 0
        ? inv.paymentLog[inv.paymentLog.length - 1].date
        : undefined;
      events.push({
        monthKey: monthKeyOfDate(lastLoggedDate || inv.paidDate || inv.invoiceDate),
        delta: -shortfall,
      });
    }
  }

  const byMonth = new Map<string, number>();
  for (const e of events) {
    byMonth.set(e.monthKey, (byMonth.get(e.monthKey) || 0) + e.delta);
  }

  const earliestMonth = events.reduce((min, e) => (e.monthKey < min ? e.monthKey : min), events[0].monthKey);
  // An invoice dated after the current month (bad data, or a future-dated draft) shouldn't make
  // the walk start after where it ends — clamp the start to "now" in that case.
  const startMonth = earliestMonth < todayMonth ? earliestMonth : todayMonth;

  const points: OutstandingTrendPoint[] = [];
  let [y, m] = startMonth.split('-').map(Number);
  let running = 0;
  // One point per calendar month; 1200 (100 years) is just a safety valve against a corrupt date
  // producing an unbounded loop, never expected to bind in practice.
  for (let i = 0; i < 1200; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    running += byMonth.get(key) || 0;
    points.push({ monthKey: key, outstanding: roundMoney(running) });
    if (key >= todayMonth) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return points;
}
