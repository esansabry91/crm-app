import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { UserProfile, WorkspaceDirectoryEntry } from '../types';

function directoryCollection() {
  return collection(db, 'workspaceDirectory');
}

/**
 * Keeps this signed-in user's own /workspaceDirectory/{uid} entry in sync with their /users
 * profile — called once whenever My Workspace mounts (see MyWorkspacePage.tsx). A deliberately
 * minimal name/department mirror, NOT a read of /users itself (see firestore.rules' /users rules,
 * scoped much narrower than this), so every active user can see every other active user's name
 * for the Meeting attendee picker regardless of role or branch.
 */
export async function syncOwnWorkspaceDirectoryEntry(profile: UserProfile): Promise<void> {
  await setDoc(doc(directoryCollection(), profile.uid), {
    uid: profile.uid,
    name: profile.name,
    department: profile.department,
    active: profile.active !== false,
  });
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
