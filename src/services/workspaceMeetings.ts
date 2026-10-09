/**
 * My Workspace meetings — ported from gdsb-portal's apps/worker/src/routes/workspaceMeetings.ts
 * (meeting CRUD, attendee invite/decline, per-person minutes, and the notifications those actions
 * send), translated from a Hono/D1 REST API into direct Firestore reads/writeBatch writes.
 *
 * A meeting belongs to the user who created it (the organizer). They can invite other portal
 * users as attendees: the meeting then shows in each attendee's own calendar (see
 * subscribeMyWorkspaceMeetings() below) and they get a notification (services/
 * workspaceNotifications.ts). Only the organizer edits or deletes it; an attendee can only
 * decline, which takes it off their own calendar. Everyone on a meeting keeps their own private
 * write-up of it (the /minutes subcollection).
 */
import { collection, deleteDoc, doc, getDoc, onSnapshot, query, setDoc, where, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';
import type { WorkspaceMeeting, WorkspaceMeetingAttendee, WorkspaceMeetingMode } from '../types';
import { queueWorkspaceNotification } from './workspaceNotifications';

function meetingsCollection() {
  return collection(db, 'workspaceMeetings');
}

function minutesDoc(meetingId: string, uid: string) {
  return doc(db, 'workspaceMeetings', meetingId, 'minutes', uid);
}

function mergeById(buckets: WorkspaceMeeting[][]): WorkspaceMeeting[] {
  const seen = new Map<string, WorkspaceMeeting>();
  for (const bucket of buckets) for (const m of bucket) seen.set(m.id, m);
  return Array.from(seen.values());
}

/** Every meeting this user organizes, plus every meeting they're invited to and haven't declined
 *  — two equality-only queries merged client-side (organizerUid == me) OR
 *  (invitedUids array-contains me), same "merge two queries client-side" shape
 *  sitesListPlan()/usersListPlan() in utils/firestoreAccess.ts already use, needed because
 *  firestore.rules' read rule can't be proven by a single query across two different fields. */
export function subscribeMyWorkspaceMeetings(
  uid: string,
  callback: (meetings: WorkspaceMeeting[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const queries = [query(meetingsCollection(), where('organizerUid', '==', uid)), query(meetingsCollection(), where('invitedUids', 'array-contains', uid))];
  const buckets: WorkspaceMeeting[][] = queries.map(() => []);
  const unsubs = queries.map((q, i) =>
    onSnapshot(
      q,
      (snap) => {
        buckets[i] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkspaceMeeting, 'id'>) }));
        const merged = mergeById(buckets);
        merged.sort((a, b) => (a.date === b.date ? (a.startTime || '').localeCompare(b.startTime || '') : a.date < b.date ? -1 : 1));
        callback(merged);
      },
      (err) => onError?.(err)
    )
  );
  return () => unsubs.forEach((u) => u());
}

export interface WorkspaceMeetingFormInput {
  date: string;
  startTime: string | null;
  endTime: string | null;
  title: string;
  withWhom: string;
  notes: string;
  mode: WorkspaceMeetingMode;
  link: string;
  location: string;
  /** Attendees picked in this edit — never includes the organizer themselves. */
  attendees: { uid: string; name: string }[];
}

function when(m: Pick<WorkspaceMeetingFormInput, 'date' | 'startTime' | 'endTime'>): string {
  const t = m.startTime ? `${m.startTime}${m.endTime ? `–${m.endTime}` : ''}` : 'all day';
  return `${m.date}, ${t}`;
}

function where_(m: Pick<WorkspaceMeetingFormInput, 'mode' | 'location'>): string {
  if (m.mode === 'online') return ' · Online';
  if (m.mode === 'physical') return m.location ? ` · ${m.location}` : ' · In person';
  return '';
}

export async function createWorkspaceMeeting(organizerUid: string, organizerName: string, input: WorkspaceMeetingFormInput): Promise<void> {
  const now = Date.now();
  const attendees: Record<string, WorkspaceMeetingAttendee> = {};
  const invitedUids: string[] = [];
  for (const a of input.attendees) {
    attendees[a.uid] = { uid: a.uid, name: a.name, status: 'invited', invitedAt: now };
    invitedUids.push(a.uid);
  }
  const meetingRef = doc(meetingsCollection());
  const batch = writeBatch(db);
  batch.set(meetingRef, {
    organizerUid,
    organizerName,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    title: input.title.trim(),
    withWhom: input.withWhom.trim(),
    notes: input.notes,
    mode: input.mode,
    link: input.mode === 'online' ? input.link.trim() : '',
    location: input.mode === 'physical' ? input.location.trim() : '',
    attendees,
    invitedUids,
    createdAt: now,
    updatedAt: now,
  });
  for (const a of input.attendees) {
    queueWorkspaceNotification(batch, {
      uid: a.uid,
      kind: 'meeting_invite',
      title: `Meeting invitation: ${input.title.trim()}`,
      body: `${organizerName} invited you · ${when(input)}${where_(input)}`,
      meetingId: meetingRef.id,
      date: input.date,
    });
  }
  await batch.commit();
}

/** Organizer-only — see firestore.rules' /workspaceMeetings update rule. Recomputes the attendee
 *  set and sends the same notifications gdsb-portal's PUT /meetings/:id does: cancelled to anyone
 *  dropped, invited to anyone newly added, and (only when something they'd act on actually
 *  changed) updated to everyone who stayed invited. */
export async function updateWorkspaceMeeting(before: WorkspaceMeeting, input: WorkspaceMeetingFormInput): Promise<void> {
  const now = Date.now();
  const link = input.mode === 'online' ? input.link.trim() : '';
  const location = input.mode === 'physical' ? input.location.trim() : '';
  const hadUids = new Set(Object.keys(before.attendees));
  const keepUids = new Set(input.attendees.map((a) => a.uid));
  const added = input.attendees.filter((a) => !hadUids.has(a.uid));
  const removed = Object.values(before.attendees).filter((a) => !keepUids.has(a.uid));
  const stayedInvited = Object.values(before.attendees).filter((a) => keepUids.has(a.uid) && a.status === 'invited');
  const changed =
    before.date !== input.date ||
    before.startTime !== input.startTime ||
    before.endTime !== input.endTime ||
    before.title !== input.title.trim() ||
    before.mode !== input.mode ||
    before.link !== link ||
    before.location !== location;

  const attendees: Record<string, WorkspaceMeetingAttendee> = {};
  const invitedUids: string[] = [];
  for (const a of input.attendees) {
    const existing = before.attendees[a.uid];
    const entry: WorkspaceMeetingAttendee = existing ? { ...existing, name: a.name } : { uid: a.uid, name: a.name, status: 'invited', invitedAt: now };
    attendees[a.uid] = entry;
    if (entry.status === 'invited') invitedUids.push(a.uid);
  }

  const batch = writeBatch(db);
  batch.update(doc(meetingsCollection(), before.id), {
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    title: input.title.trim(),
    withWhom: input.withWhom.trim(),
    notes: input.notes,
    mode: input.mode,
    link,
    location,
    attendees,
    invitedUids,
    updatedAt: now,
  });
  for (const a of removed) {
    if (a.status !== 'invited') continue;
    queueWorkspaceNotification(batch, {
      uid: a.uid,
      kind: 'meeting_cancelled',
      title: `Removed from meeting: ${before.title}`,
      body: `${before.organizerName} took you off this meeting · ${when(before)}`,
      meetingId: null,
      date: before.date,
    });
  }
  for (const a of added) {
    queueWorkspaceNotification(batch, {
      uid: a.uid,
      kind: 'meeting_invite',
      title: `Meeting invitation: ${input.title.trim()}`,
      body: `${before.organizerName} invited you · ${when(input)}${where_(input)}`,
      meetingId: before.id,
      date: input.date,
    });
  }
  if (changed) {
    for (const a of stayedInvited) {
      queueWorkspaceNotification(batch, {
        uid: a.uid,
        kind: 'meeting_updated',
        title: `Meeting updated: ${input.title.trim()}`,
        body: `Now ${when(input)}${where_(input)}`,
        meetingId: before.id,
        date: input.date,
      });
    }
  }
  await batch.commit();
}

/** Organizer-only. Tells everyone still invited the meeting is off. Each attendee's own private
 *  minutes doc (the /minutes subcollection) is left in place — firestore.rules never lets the
 *  organizer touch another attendee's write-up, so there's no way to cascade-delete those from
 *  here; this mirrors the one place this port can't fully match gdsb-portal's server-side
 *  ON DELETE CASCADE, which ran with full database trust. */
export async function deleteWorkspaceMeeting(meeting: WorkspaceMeeting): Promise<void> {
  const batch = writeBatch(db);
  for (const a of Object.values(meeting.attendees)) {
    if (a.status !== 'invited') continue;
    queueWorkspaceNotification(batch, {
      uid: a.uid,
      kind: 'meeting_cancelled',
      title: `Meeting cancelled: ${meeting.title}`,
      body: `${meeting.organizerName} cancelled it · ${when(meeting)}`,
      meetingId: null,
      date: meeting.date,
    });
  }
  batch.delete(doc(meetingsCollection(), meeting.id));
  await batch.commit();
}

/** An attendee declines: the meeting leaves their own calendar (subscribeMyWorkspaceMeetings()
 *  stops returning it to them) and the organizer is notified. Never callable by the organizer
 *  themselves — see firestore.rules, which also only allows changing this one attendee's own
 *  entry plus invitedUids, nothing else about the meeting. */
export async function declineWorkspaceMeeting(meeting: WorkspaceMeeting, uid: string, declinerName: string): Promise<void> {
  const attendees: Record<string, WorkspaceMeetingAttendee> = { ...meeting.attendees, [uid]: { ...meeting.attendees[uid], status: 'declined' } };
  const invitedUids = meeting.invitedUids.filter((id) => id !== uid);
  const batch = writeBatch(db);
  batch.update(doc(meetingsCollection(), meeting.id), { attendees, invitedUids, updatedAt: Date.now() });
  queueWorkspaceNotification(batch, {
    uid: meeting.organizerUid,
    kind: 'meeting_declined',
    title: `${declinerName} declined: ${meeting.title}`,
    body: when(meeting),
    meetingId: meeting.id,
    date: meeting.date,
  });
  await batch.commit();
}

/** The signed-in user's own write-up of a meeting they organized or attend. */
export function subscribeOwnMeetingMinutes(
  meetingId: string,
  uid: string,
  callback: (body: string) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    minutesDoc(meetingId, uid),
    (snap) => callback(snap.exists() ? ((snap.data().body as string) ?? '') : ''),
    (err) => onError?.(err)
  );
}

export async function saveOwnMeetingMinutes(meetingId: string, uid: string, body: string): Promise<void> {
  const ref = minutesDoc(meetingId, uid);
  if (!body.trim()) {
    const existing = await getDoc(ref);
    if (existing.exists()) await deleteDoc(ref);
    return;
  }
  await setDoc(ref, { body, updatedAt: Date.now() });
}
