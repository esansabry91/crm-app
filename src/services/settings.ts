import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { AppSettings } from '../types';

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

/** Admin-only (enforced by firestore.rules) — flips Testing Mode from the toggle in
 *  src/components/admin/TestingDataTool.tsx. */
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
