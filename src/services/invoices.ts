import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
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
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  lineGroups: InvoiceLineGroup[];
  sstRate: number;
  signatoryName?: string;
  signatoryTitle?: string;
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
      siteId: input.siteId,
      siteName: input.siteName,
      tenderId: input.tenderId,
      clientName: input.clientName,
      clientAddress: input.clientAddress || '',
      attnName: input.attnName || '',
      invoiceNo: number,
      invoiceDate: input.invoiceDate,
      billingMonth: input.billingMonth,
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

export async function updateInvoiceStatus(
  id: string,
  patch: { status: InvoiceStatus; amountPaid: number; paidDate?: string }
): Promise<void> {
  await updateDoc(doc(db, 'invoices', id), {
    status: patch.status,
    amountPaid: patch.amountPaid,
    paidDate: patch.paidDate || null,
    updatedAt: Date.now(),
  });
}
