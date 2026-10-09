/**
 * In-app notifications for My Workspace meeting events — ported from gdsb-portal's
 * apps/worker/src/routes/workspaceMeetings.ts (its notify() helper + GET /notifications +
 * POST /notifications/read), translated to direct Firestore writes. createWorkspaceNotification()
 * is called by services/workspaceMeetings.ts whenever an invite/update/cancellation/decline needs
 * to tell someone — never called directly from UI code.
 */
import { collection, doc, onSnapshot, query, updateDoc, where, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkspaceNotification, WorkspaceNotificationKind } from '../types';

const RECENT_LIMIT = 30;

function notificationsCollection() {
  return collection(db, 'workspaceNotifications');
}

/** Every notification addressed to this user — equality-only query (see services/workspace.ts's
 *  own doc comment on why), client-sorted newest first and capped to the most recent 30, matching
 *  gdsb-portal's own `LIMIT 30`. */
export function subscribeMyWorkspaceNotifications(
  uid: string,
  callback: (notifications: WorkspaceNotification[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(notificationsCollection(), where('uid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkspaceNotification, 'id'>) }));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      callback(rows.slice(0, RECENT_LIMIT));
    },
    (err) => onError?.(err)
  );
}

/** Queues one notification doc onto an in-flight writeBatch — the caller (services/
 *  workspaceMeetings.ts) commits the batch alongside whatever meeting/attendee write triggered
 *  it, so the two are written atomically together. */
export function queueWorkspaceNotification(
  batch: ReturnType<typeof writeBatch>,
  input: {
    uid: string;
    kind: WorkspaceNotificationKind;
    title: string;
    body: string;
    meetingId: string | null;
    date: string | null;
  }
): void {
  batch.set(doc(notificationsCollection()), {
    uid: input.uid,
    kind: input.kind,
    title: input.title,
    body: input.body,
    meetingId: input.meetingId,
    date: input.date,
    createdAt: Date.now(),
    readAt: null,
  });
}

export async function markWorkspaceNotificationRead(notificationId: string): Promise<void> {
  await updateDoc(doc(notificationsCollection(), notificationId), { readAt: Date.now() });
}

export async function markAllWorkspaceNotificationsRead(unreadIds: string[]): Promise<void> {
  if (!unreadIds.length) return;
  const batch = writeBatch(db);
  const now = Date.now();
  unreadIds.forEach((id) => batch.update(doc(notificationsCollection(), id), { readAt: now }));
  await batch.commit();
}
