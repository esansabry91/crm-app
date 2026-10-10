import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, disposeSecondaryApp, getSecondaryAuth } from '../firebase';
import type { Role } from '../types';

/**
 * Self-service: a signed-in user changing THEIR OWN language preference from the header's
 * toggle (AppLayout.tsx) — distinct from updateUserProfile() below, which is the admin-only
 * "edit someone else's profile" path. firestore.rules only lets this one field be written by
 * anyone other than an admin, and only on the caller's own /users/{uid} doc — see its own
 * comment on the /users/{uid} match block.
 */
export async function updateOwnLanguage(uid: string, language: 'en' | 'ms') {
  await updateDoc(doc(db, 'users', uid), { language });
}

export interface NewStaffInput {
  name: string;
  email: string;
  role: Role;
  department: string;
}

/** A password nobody will ever see or use — the account holder sets their real one via the emailed link. */
function throwawayPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

/**
 * Creates a new team member's Firebase Auth account + Firestore profile, WITHOUT signing the
 * admin out of their own session. Uses a throwaway secondary Firebase App instance for the
 * createUser call, then discards it. The account is created with a random password nobody
 * knows — we immediately email the new team member a "set your password" link (Firebase's
 * password-reset email, repurposed as a first-login invite) so the admin never has to
 * communicate a password by hand.
 */
export async function createStaffAccount(input: NewStaffInput) {
  const { secondaryApp, secondaryAuth } = getSecondaryAuth();
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, input.email, throwawayPassword());
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: input.name,
      email: input.email,
      role: input.role,
      department: input.department,
      active: true,
      createdAt: Date.now(),
    });
    // Makes them findable/invitable as a Meeting attendee immediately — not just once they
    // themselves first sign in (see mirrorWorkspaceDirectoryFromUsersDoc()'s own doc comment).
    await mirrorWorkspaceDirectoryFromUsersDoc(cred.user.uid);
    await signOut(secondaryAuth);
    // Uses the ADMIN's own `auth` instance, not secondaryAuth — sending a reset email doesn't
    // require being signed in as that user, just needs the account to already exist (which it
    // now does).
    await sendPasswordResetEmail(auth, input.email);
    return cred.user.uid;
  } finally {
    await disposeSecondaryApp(secondaryApp);
  }
}

export async function updateUserProfile(
  uid: string,
  patch: Partial<{ name: string; role: Role; department: string; active: boolean }>
) {
  await updateDoc(doc(db, 'users', uid), patch);
  // Keeps the directory's name/department (or active, on an admin-side reactivate) current the
  // moment an admin changes it — same reasoning as createStaffAccount() above.
  await mirrorWorkspaceDirectoryFromUsersDoc(uid);
}

/**
 * Overwrites this uid's /workspaceDirectory entry to exactly match what their /users doc
 * currently says (name, department, active) — a no-op if they don't have a /users doc at all. The
 * Meeting attendee picker (MeetingDialog.tsx) reads straight off /workspaceDirectory, never
 * /users itself (see that collection's own match-block comment for why), so this is what actually
 * keeps someone findable/invitable in step with ANY admin/Branch-Manager change to their account —
 * created, renamed, moved to a different branch, deactivated, or removed — without that account
 * ever needing to sign in itself. firestore.rules' /workspaceDirectory create/update rules accept
 * this write from an admin, or from the matching Branch Manager for their own branch's Operation
 * Staff, as long as it matches userDoc(uid) exactly, same validation as the self-write path every
 * account's own WorkspaceDirectorySync.tsx uses. Always call this AFTER the /users write that
 * created or changed data (so userDoc(uid) already reflects it), except before deleteUserProfile's
 * delete below, where /users/{uid} has to still exist for this to have anything to read.
 */
async function mirrorWorkspaceDirectoryFromUsersDoc(uid: string): Promise<void> {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const data = snap.data() as { name: string; department: string; active?: boolean };
  await setDoc(doc(db, 'workspaceDirectory', uid), {
    uid,
    name: data.name,
    department: data.department,
    active: data.active !== false,
  });
}

/**
 * Deactivates a user's CRM profile so they can no longer sign in effectively (Firestore rules
 * check `active`). Does not delete the underlying Firebase Auth account — deleting arbitrary
 * Auth users requires the Admin SDK (a Cloud Function), which is outside this project's scope.
 * Also mirrors `active: false` into their /workspaceDirectory entry so they stop appearing as an
 * invitable Meeting attendee for everyone else immediately, rather than only once they next sign
 * in — which, now deactivated, they no longer can.
 */
export async function deactivateUser(uid: string) {
  await updateDoc(doc(db, 'users', uid), { active: false });
  await mirrorWorkspaceDirectoryFromUsersDoc(uid);
}

/**
 * Forces this uid's /workspaceDirectory entry to `active: false` FIRST — not whatever /users
 * currently says (an account removed without ever being deactivated first is still `active: true`
 * there right up until the delete below) — while /users/{uid} still exists to read its
 * name/department from, then removes the /users profile itself.
 */
export async function deleteUserProfile(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (snap.exists()) {
    const data = snap.data() as { name: string; department: string };
    await setDoc(doc(db, 'workspaceDirectory', uid), {
      uid,
      name: data.name,
      department: data.department,
      active: false,
    });
  }
  await deleteDoc(doc(db, 'users', uid));
}
