import { createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, disposeSecondaryApp, getSecondaryAuth } from '../firebase';
import type { Role } from '../types';

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
}

/**
 * Deactivates a user's CRM profile so they can no longer sign in effectively (Firestore rules
 * check `active`). Does not delete the underlying Firebase Auth account — deleting arbitrary
 * Auth users requires the Admin SDK (a Cloud Function), which is outside this project's scope.
 */
export async function deactivateUser(uid: string) {
  await updateDoc(doc(db, 'users', uid), { active: false });
}

export async function deleteUserProfile(uid: string) {
  await deleteDoc(doc(db, 'users', uid));
}
