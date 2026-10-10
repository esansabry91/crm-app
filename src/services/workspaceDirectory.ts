import { collection, doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile, WorkspaceDirectoryEntry } from '../types';

function directoryCollection() {
  return collection(db, 'workspaceDirectory');
}

/**
 * Keeps this signed-in user's own /workspaceDirectory/{uid} entry in sync with their /users
 * profile — called for every session, the moment their profile loads (see
 * WorkspaceDirectorySync.tsx, mounted once in App.tsx). A deliberately minimal name/department
 * mirror, NOT a read of /users itself (see firestore.rules' /users rules, scoped much narrower
 * than this), so every active user can see every other active user's name for the Meeting
 * attendee picker regardless of role or branch.
 */
export async function syncOwnWorkspaceDirectoryEntry(profile: UserProfile): Promise<void> {
  await setDoc(doc(directoryCollection(), profile.uid), {
    uid: profile.uid,
    name: profile.name,
    department: profile.department,
    active: profile.active !== false,
  });
}

/** Firestore's cap on writes in a single batch is 500 — stay comfortably under it. */
const BACKFILL_CHUNK_SIZE = 450;

/**
 * Admin-only backfill: writes every passed-in user's own /workspaceDirectory entry in one pass,
 * for accounts that signed in before WorkspaceDirectorySync.tsx existed (or just haven't signed
 * in again since) and so never got an entry themselves — until they do, they can't be found or
 * invited as a Meeting attendee at all (see MeetingDialog.tsx, which reads straight off this
 * collection). Pass it the admin's own full useUsers() list (every user, since isAdmin() gets the
 * whole /users collection — see that hook's own doc comment); mirrors exactly what each user's own
 * /users doc already says, same validation firestore.rules' /workspaceDirectory create rule
 * enforces for this admin path. Safe to re-run any time — every write is idempotent.
 */
export async function backfillWorkspaceDirectoryEntries(users: UserProfile[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < users.length; i += BACKFILL_CHUNK_SIZE) {
    const chunk = users.slice(i, i + BACKFILL_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const u of chunk) {
      batch.set(doc(directoryCollection(), u.uid), {
        uid: u.uid,
        name: u.name,
        department: u.department,
        active: u.active !== false,
      });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/**
 * Live listener over every /workspaceDirectory doc — safe unfiltered, since
 * firestore.rules' read rule for this collection (isActiveUser()) depends only on the CALLER's
 * own /users doc, never on resource.data, same reasoning as subscribeAllEmployeeFeedback() in
 * services/employeeFeedback.ts.
 */
export function subscribeWorkspaceDirectory(
  callback: (entries: WorkspaceDirectoryEntry[]) => void,
  onError?: (err: Error) => void
): () => void {
  return onSnapshot(
    directoryCollection(),
    (snap) => {
      callback(snap.docs.map((d) => d.data() as WorkspaceDirectoryEntry));
    },
    (err) => onError?.(err)
  );
}
