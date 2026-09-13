import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { shouldStampTestData } from './settings';
import type { Invoice, InvoiceLineGroup, InvoiceStatus, Role } from '../types';

function invoicesCollection() {
  return collection(db, 'invoices');
}

/** Hours-per-shift baked into every invoice line's amount — see InvoiceLineRow's doc comment in
 *  types.ts. A 12-hour shift is what the sample invoices this feature was built from use; pulled
 *  out as a constant so it's the one place to change if a future contract uses a different one. */
export const INVOICE_HOURS_PER_SHIFT = 12;

/** headcount * days * 12-hour shift * hourly rate — the exact formula the sample invoices this
 *  feature was modeled on come out to. Centralized so the generator form and any future edit
 *  flow compute a saved invoice's line amount identically. */
export function computeLineAmount(headcount: number, days: number, rate: number): number {
  return headcount * days * INVOICE_HOURS_PER_SHIFT * rate;
}

export function sumLineGroups(lineGroups: InvoiceLineGroup[]): number {
  return lineGroups.reduce(
    (sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + row.amount, 0),
    0
  );
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
  lineGroups: InvoiceLineGroup[];
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
  const subTotal = sumLineGroups(input.lineGroups);
  const sstAmount = subTotal * input.sstRate;
  const total = subTotal + sstAmount;
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
      lineGroups: input.lineGroups,
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

export function subscribeInvoices(callback: (invoices: Invoice[]) => void): () => void {
  const q = query(invoicesCollection(), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Invoice, 'id'>) })));
  });
}

/**
 * Updates an invoice's payment status. `previousAmountPaid` is the amountPaid the invoice had
 * before this edit (the caller already has the Invoice loaded, so no extra read here) — the
 * difference between it and `amountPaid` is what gets appended to paymentLog as one installment,
 * so a running history of payments survives even though amountPaid itself is only ever the
 * latest cumulative total. A save that doesn't actually move the amount (e.g. just switching the
 * status dropdown) logs nothing — the log is a record of real payments, not of edits.
 */
export async function updateInvoiceStatus(
  id: string,
  patch: { status: InvoiceStatus; amountPaid: number; paidDate?: string; previousAmountPaid: number },
  actor: { uid: string; name: string }
): Promise<void> {
  const delta = patch.amountPaid - patch.previousAmountPaid;
  const updates: Record<string, unknown> = {
    status: patch.status,
    amountPaid: patch.amountPaid,
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
 *  matching Branch record (matching case/whitespace-insensitively; see `normalizeBranchName`). */
async function loadSiteAndBranchLookups() {
  const [sitesSnap, branchesSnap] = await Promise.all([
    getDocs(collection(db, 'sites')),
    getDocs(collection(db, 'branches')),
  ]);

  const siteBranchById = new Map<string, string>();
  sitesSnap.forEach((d) => {
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

export async function backfillInvoiceBranches(): Promise<BackfillBranchResult> {
  const [invoicesSnap, { siteBranchById, branchByNormalizedName }] = await Promise.all([
    getDocs(invoicesCollection()),
    loadSiteAndBranchLookups(),
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
export async function diagnoseInvoiceBranches(): Promise<InvoiceBranchDiagnostic[]> {
  const [invoicesSnap, { siteBranchById, branchByNormalizedName }] = await Promise.all([
    getDocs(invoicesCollection()),
    loadSiteAndBranchLookups(),
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
