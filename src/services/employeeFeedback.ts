import { collection, doc, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
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
 * Live listener over every /employeeFeedback doc of the given type (Suggestion or Complaint) —
 * receiver roles only (CEO, Director, HQ Admin, Tender Controller, HR Manager — see
 * firestore.rules' isFeedbackReceiver()); every other role's read is denied server-side no
 * matter what this is called with. Deliberately filters by `type` alone with no `orderBy` in the
 * query — same composite-index-avoidance reasoning as subscribeInvoices() in
 * services/invoices.ts — and sorts client-side by createdAt (newest first) once the snapshot
 * arrives, rather than requiring a composite index that can't be created from this environment.
 */
export function subscribeEmployeeFeedback(
  type: FeedbackType,
  callback: (items: EmployeeFeedback[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(feedbackCollection(), where('type', '==', type));
  return onSnapshot(
    q,
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
