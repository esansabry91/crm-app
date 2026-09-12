import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { AppSettings, Role, UserProfile } from '../types';

function settingsDocRef() {
  return doc(db, 'settings', 'app');
}

/**
 * One-shot read of whether Testing Mode is currently on — used at record-creation time
 * (createTender/registerGuard/registerBufferGuard) to decide whether to stamp the new record
 * isTestData: true. A fresh read rather than cached/subscribed state, since these creation
 * functions are called from all over the app and a stale value here would silently mistag
 * records right at the moment Testing Mode is flipped. Defaults to false (real data) if the
 * settings doc doesn't exist yet or the read fails — never blocks the caller's own action.
 */
export async function getTestingModeEnabled(): Promise<boolean> {
  try {
    const snap = await getDoc(settingsDocRef());
    return snap.exists() ? !!(snap.data() as Partial<AppSettings>).testingModeEnabled : false;
  } catch {
    return false;
  }
}

/** Developer-only (enforced by firestore.rules' isDeveloper()) — flips Testing Mode from the
 *  toggle in src/components/admin/TestingDataTool.tsx. Not admin-writable on purpose: see
 *  AdminPage.tsx for why the Testing Data tab itself is hidden from every role but developer. */
export async function setTestingModeEnabled(enabled: boolean, actor: { name: string }): Promise<void> {
  await setDoc(
    settingsDocRef(),
    { testingModeEnabled: enabled, updatedAt: Date.now(), updatedByName: actor.name },
    { merge: true }
  );
}

/** Live subscription for the toggle UI — see getTestingModeEnabled() for the one-shot read used
 *  at record-creation time instead. */
export function subscribeTestingModeEnabled(callback: (enabled: boolean) => void): () => void {
  return onSnapshot(
    settingsDocRef(),
    (snap) => callback(snap.exists() ? !!(snap.data() as Partial<AppSettings>).testingModeEnabled : false),
    () => callback(false)
  );
}

/**
 * True if the currently signed-in user's own role is 'developer' — the CRM's dedicated
 * account-level tag for the owner's own testing account (see Role's doc comment in types.ts).
 * Pass `explicitRole` when the caller already has the acting user's role at hand (e.g.
 * createTender's `actor.role`) to skip an extra Firestore read; otherwise this looks up the
 * signed-in user's own profile (self-reads are always allowed by firestore.rules).
 */
export async function isDeveloperAccount(explicitRole?: Role | null): Promise<boolean> {
  if (explicitRole) return explicitRole === 'developer';
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as Partial<UserProfile>).role === 'developer' : false;
  } catch {
    return false;
  }
}

/**
 * What every record-creation function (createTender/registerGuard/registerBufferGuard, and the
 * Duty Roster equivalents in public/duty-roster/index.html) should actually stamp isTestData
 * with — purely whether the creating account is itself a 'developer' account. Deliberately NOT
 * OR'd with the global Testing Mode toggle (getTestingModeEnabled() below) any more: that toggle
 * is a single doc shared by everyone, so while it was part of this OR, a developer switching it
 * on to test would also silently tag whatever a real staff/admin account happened to create at
 * the same moment as test data — exactly the mix-up this whole mechanism exists to prevent.
 * Being purely role-based instead makes the guarantee unconditional: a developer account's own
 * data is always test data, and every other account's data is always genuine, regardless of
 * what the toggle (now just a legacy/inert setting — see its own doc comment) is set to.
 */
export async function shouldStampTestData(explicitRole?: Role | null): Promise<boolean> {
  return isDeveloperAccount(explicitRole);
}
