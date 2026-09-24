import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { EmployeeFeedback, EmployeeFeedbackSender, FeedbackCategory, FeedbackType } from '../types';

function feedbackCollection() {
  return collection(db, 'employeeFeedback');
}

function feedbackSendersCollection() {
  return collection(db, 'employeeFeedbackSenders');
}

export interface SubmitEmployeeFeedbackInput {
  type: FeedbackType;
  category: FeedbackCategory;
  message: string;
  senderUid: string;
  senderName: string;
}

/**
 * Submits one anonymous suggestion or complaint. Writes the content half
 * (/employeeFeedback/{id}) and the sender-identity half (/employeeFeedbackSenders/{id}, same id)
 * together in one writeBatch, so a submission can never exist half-anonymized — see the doc
 * comment above canSeeFeedbackSender() in types.ts for why the two collections exist at all
 * (Firestore rules can't redact individual fields per role within a single document). No read
 * happens first — the sender's own identity is already known client-side (from useAuth()), so a
 * plain writeBatch is enough; no transaction is needed.
 */
export async function submitEmployeeFeedback(input: SubmitEmployeeFeedbackInput): Promise<void> {
  const feedbackRef = doc(feedbackCollection());
  const senderRef = doc(feedbackSendersCollection(), feedbackRef.id);
  const batch = writeBatch(db);
  batch.set(feedbackRef, {
    type: input.type,
    category: input.category,
    message: input.message,
    createdAt: Date.now(),
  });
  batch.set(senderRef, {
    senderUid: input.senderUid,
    senderName: input.senderName,
  });
  await batch.commit();
}

/**
 * Live listener over the ENTIRE /employeeFeedback collection, both Suggestion and Complaint
 * together, unfiltered — receiver roles only (CEO, Director, HQ Admin, Tender Controller, HR
 * Manager — see firestore.rules' isFeedbackReceiver()); every other role's read is denied
 * server-side no matter what this is called with. An unfiltered listen is safe here (no
 * composite-index/query-plannability concern — contrast subscribeInvoices() in
 * services/invoices.ts, which DOES need to filter) because isFeedbackReceiver() depends only on
 * the CALLER's own /users doc, never on resource.data, so Firestore can always prove the rule
 * regardless of which documents come back. Returns everything so EmployeeFeedbackPage.tsx can
 * compute its Suggestion/Complaint stat tiles and its month/category filters across both types
 * at once, then slice by type/category/month entirely client-side — sorted newest first.
 */
export function subscribeAllEmployeeFeedback(
  callback: (items: EmployeeFeedback[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    feedbackCollection(),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmployeeFeedback, 'id'>) }));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      callback(rows);
    },
    (err) => onError?.(err)
  );
}

/**
 * Live listener over every /employeeFeedbackSenders doc — CEO/Director only (see
 * firestore.rules' canSeeFeedbackSender()); every other role's read is denied server-side.
 * Keyed by doc id, which matches its paired /employeeFeedback doc's id 1:1, so the caller can
 * join sender identity onto a feedback item purely client-side — only for the two roles that
 * are ever allowed to see it at all.
 */
export function subscribeEmployeeFeedbackSenders(
  callback: (items: EmployeeFeedbackSender[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    feedbackSendersCollection(),
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmployeeFeedbackSender, 'id'>) }));
      callback(rows);
    },
    (err) => onError?.(err)
  );
}
