import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
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

export interface NewInvoiceInput {
  brandId: string;
  brandName: string;
  siteId: string | null;
  siteName: string;
  tenderId: string | null;
  clientName: string;
  clientAddress?: string;
  attnName?: string;
  invoiceNo: string;
  invoiceDate: string;
  billingMonth: string;
  contractRef?: string;
  quotationNo?: string;
  paymentTermsDays: number;
  lineGroups: InvoiceLineGroup[];
  sstRate: number;
}

/** Actor performing the create — same shape as createTender's Actor (src/services/tenders.ts),
 *  so a developer account's invoices are tagged isTestData the same way everything else is. */
type Actor = { uid: string; name: string; role?: Role };

export async function createInvoice(input: NewInvoiceInput, actor: Actor): Promise<string> {
  const now = Date.now();
  const subTotal = sumLineGroups(input.lineGroups);
  const sstAmount = subTotal * input.sstRate;
  const total = subTotal + sstAmount;
  const isTestData = await shouldStampTestData(actor.role);

  const ref = await addDoc(invoicesCollection(), {
    brandId: input.brandId,
    brandName: input.brandName,
    siteId: input.siteId,
    siteName: input.siteName,
    tenderId: input.tenderId,
    clientName: input.clientName,
    clientAddress: input.clientAddress || '',
    attnName: input.attnName || '',
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    billingMonth: input.billingMonth,
    contractRef: input.contractRef || '',
    quotationNo: input.quotationNo || '',
    paymentTermsDays: input.paymentTermsDays,
    lineGroups: input.lineGroups,
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
  return ref.id;
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
