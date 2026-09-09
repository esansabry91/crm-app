#!/usr/bin/env node
/**
 * Purge test / scratch data from the Tender Pipeline CRM's Firestore database.
 *
 * Signs in with a real admin email/password through the same client-side Firebase SDK the app
 * itself uses, rather than a service-account key — this respects the existing firestore.rules
 * (an admin can read/write everything) and avoids handling a sensitive service-account
 * credential file. It doesn't bypass security rules; it does, as an authenticated admin,
 * exactly what an admin could already do by hand in the app — delete tenders, their `history`
 * subcollection entries, and (in --uid mode) one team member's Firestore profile.
 *
 * This does NOT delete anyone's Firebase Auth sign-in (email/password login) — removing another
 * user's Auth account needs the Admin SDK / a service-account key, which this script
 * deliberately doesn't use. Do that part yourself in Firebase console -> Authentication -> Users
 * if you need a test account's login gone too.
 *
 * IMPORTANT: deleting a history entry requires firestore.rules to allow admin deletes on
 * /tenders/{id}/history/{id} (the default rules made history immutable, including to admins).
 * Deploy the updated firestore.rules in this repo (`npx firebase-tools deploy --only
 * firestore:rules`) before running this script, or history cleanup will fail with
 * permission-denied.
 *
 * Usage (run from the project root, e.g. ~/Desktop/crm-app-fresh/crm-app):
 *
 *   node scripts/purge-test-data.mjs --all
 *       Deletes EVERY tender and its full history log, across every branch and HQ, regardless
 *       of who owns it. Leaves branches, brands, and every team member's profile untouched.
 *       Use this for a one-time full reset back to zero tenders.
 *
 *   node scripts/purge-test-data.mjs --uid=<firebase-auth-uid>
 *       Deletes only the tenders (+ history) owned by that one user, and that user's own
 *       Firestore profile doc (users/{uid}). Use this going forward, each time you're done
 *       testing with a throwaway test account, to fully retire its data without touching
 *       anyone else's records. Find a user's UID in Firebase console -> Authentication -> Users.
 *
 * Either mode prints exactly what it found and requires you to type DELETE to confirm before
 * anything is actually removed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  writeBatch,
} from 'firebase/firestore';

const scriptDir = dirname(fileURLToPath(import.meta.url));

// ---- load .env (VITE_FIREBASE_* values) without adding a dotenv dependency ----
function loadEnv() {
  const envPath = join(scriptDir, '..', '.env');
  if (!existsSync(envPath)) {
    console.error(
      'No .env file found in the project root. Copy .env.example to .env and fill in your Firebase config first.'
    );
    process.exit(1);
  }
  const text = readFileSync(envPath, 'utf8');
  const lines = text.split(String.fromCharCode(10));
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.charAt(0) === '#') continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

for (const [key, value] of Object.entries(firebaseConfig)) {
  if (!value) {
    console.error(`Missing ${key} in .env - check your .env file has all six VITE_FIREBASE_* values.`);
    process.exit(1);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

/**
 * Prompts for input without echoing it to the terminal — used for the admin password.
 *
 * This deliberately drives the prompt through the SAME `rl` (readline) interface used by ask(),
 * rather than attaching a second raw stdin listener next to it. An earlier version of this
 * script tried the latter (stdin.setRawMode(true) + its own 'data' listener) and it silently
 * failed on at least one real terminal (macOS Terminal.app): readline's own internal keypress
 * handling — which is what actually echoes characters back to the screen while `rl` is open —
 * ran independently of that extra listener and kept echoing every keystroke anyway, so the
 * password was printed in plain text. Muting rl's own output function while it reads the line
 * avoids that conflict entirely, since it's the same code path doing the echoing.
 */
function askHidden(promptText) {
  return new Promise((resolve) => {
    const originalWriteToOutput = rl._writeToOutput;
    rl._writeToOutput = function muted(stringToWrite) {
      // Let the prompt text itself and the newline after Enter through; swallow everything else
      // (i.e. every echoed keystroke of the password).
      if (stringToWrite === promptText || stringToWrite === '\n' || stringToWrite === '\r\n') {
        originalWriteToOutput.call(rl, stringToWrite);
      }
    };
    rl.question(promptText, (value) => {
      rl._writeToOutput = originalWriteToOutput;
      // rl.question's own newline write happens before we restore output above in some Node
      // versions, so make sure the cursor is definitely on a fresh line before anything else
      // gets printed (harmless no-op if it already is).
      process.stdout.write('\n');
      resolve(value);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const allMode = args.includes('--all');
  const uidArg = args.find((a) => a.startsWith('--uid='));
  const uid = uidArg ? uidArg.split('=')[1] : null;

  if (!allMode && !uid) {
    console.error(
      'Usage:\n  node scripts/purge-test-data.mjs --all\n  node scripts/purge-test-data.mjs --uid=<firebase-auth-uid>'
    );
    process.exit(1);
  }
  if (allMode && uid) {
    console.error('Pass either --all or --uid=<uid>, not both.');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log(
    'Sign in with an ADMIN account - this script needs admin rights to read and delete every matching tender.\n'
  );
  const email = await ask('Admin email: ');
  const password = await askHidden('Admin password: ');

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // Force-refresh the ID token and wait for it before doing anything else. The sign-in promise
    // above can resolve before Firestore's own internal auth listener (which is what actually
    // attaches the token to outgoing requests) has caught up - in a plain Node script (unlike in
    // the browser app) that race is very easy to lose, and the very first Firestore call goes out
    // effectively unauthenticated and comes back permission-denied even though sign-in "worked."
    await credential.user.getIdToken(true);
  } catch (err) {
    console.error('\nSign-in failed:', err.message);
    rl.close();
    process.exit(1);
  }
  console.log(`\nSigned in as ${email}.\n`);

  // ---- self-diagnostic: read back this account's own profile doc. This read is ALWAYS allowed
  // by firestore.rules regardless of role (a user can always read their own /users/{uid} doc), so
  // if this also fails, the problem isn't about admin rights at all - it's something more basic
  // (wrong project, rules not actually deployed, etc). If it succeeds, it prints exactly what
  // Firestore has stored for this account, which settles the role/active question for good.
  const selfUid = auth.currentUser.uid;
  try {
    const selfSnap = await getDoc(doc(db, 'users', selfUid));
    console.log(`Diagnostic - your own profile doc at users/${selfUid}:`);
    if (!selfSnap.exists()) {
      console.log(
        '  Does not exist! There is no users/{uid} document at this exact UID, which is why ' +
          "isAdmin() fails - the app must be reading your role from somewhere else, or you're " +
          'signed into a different account than the one with the admin profile.'
      );
    } else {
      console.log('  ', JSON.stringify(selfSnap.data()));
    }
  } catch (err) {
    console.log(`Diagnostic - could not even read your own profile doc: ${err.code || err.message}`);
  }
  console.log('');

  // ---- gather what would be deleted ----
  let tendersSnap;
  let historySnapAll;
  try {
    tendersSnap = allMode
      ? await getDocs(collection(db, 'tenders'))
      : await getDocs(query(collection(db, 'tenders'), where('ownerUid', '==', uid)));

    // history is a collectionGroup, so this also catches orphaned history rows left behind by any
    // tender that was already deleted through the app before this script ever ran.
    historySnapAll = await getDocs(collectionGroup(db, 'history'));
  } catch (err) {
    if (err.code === 'permission-denied') {
      console.error(
        `\nFirestore rejected this read as permission-denied, even though ${email} signed in successfully.\n` +
          'This means Firestore does not currently see this account as an active admin. Most likely causes:\n' +
          '  1. firestore.rules was deployed only moments ago and has not fully propagated yet - wait\n' +
          '     20-30 seconds and run this command again.\n' +
          "  2. This account's /users/{uid} profile in Firestore doesn't have role exactly \"admin\", or\n" +
          '     has active set to false. Check it in Firebase console -> Firestore Database -> users\n' +
          '     collection -> the document for this account.\n' +
          '  3. The .env file in this project points at a different Firebase project than the one\n' +
          '     firestore.rules was just deployed to - check VITE_FIREBASE_PROJECT_ID in .env matches\n' +
          '     the project shown after "Deploying to \'...\'" in the deploy output.'
      );
    } else {
      console.error('\nUnexpected error while reading data:', err.message);
    }
    rl.close();
    process.exit(1);
  }

  const historyDocsToDelete = historySnapAll.docs.filter((d) =>
    allMode ? true : d.data().ownerUid === uid
  );

  console.log('This will permanently delete:');
  console.log(`  - ${tendersSnap.docs.length} tender record(s)`);
  console.log(
    `  - ${historyDocsToDelete.length} history log entrie(s) (including any already-orphaned ones)`
  );
  if (!allMode) {
    console.log(`  - the Firestore profile for user ${uid}`);
  }
  console.log(
    "\nThis does NOT delete anyone's Firebase Auth sign-in (email/password login) - do that separately in Firebase console -> Authentication -> Users if needed.\n"
  );

  if (tendersSnap.docs.length === 0 && historyDocsToDelete.length === 0) {
    console.log('Nothing matched - there is nothing to delete.');
    rl.close();
    return;
  }

  const confirm = await ask('Type DELETE (all caps) to proceed, or anything else to cancel: ');
  if (confirm.trim() !== 'DELETE') {
    console.log('Cancelled - nothing was deleted.');
    rl.close();
    return;
  }

  // ---- delete in batches (Firestore batch limit is 500 writes) ----
  const refsToDelete = [
    ...historyDocsToDelete.map((d) => d.ref),
    ...tendersSnap.docs.map((d) => d.ref),
  ];
  if (!allMode) {
    refsToDelete.push(doc(db, 'users', uid));
  }

  let batch = writeBatch(db);
  let opCount = 0;
  let totalDeleted = 0;
  for (const ref of refsToDelete) {
    batch.delete(ref);
    opCount++;
    totalDeleted++;
    if (opCount === 400) {
      await batch.commit();
      batch = writeBatch(db);
      opCount = 0;
      console.log(`  ...${totalDeleted} deleted so far`);
    }
  }
  if (opCount > 0) await batch.commit();

  console.log(`\nDone - deleted ${totalDeleted} document(s).`);
  if (!allMode) {
    console.log(
      `Remember: ${uid}'s Firebase Auth login still exists. Remove it too in Firebase console -> Authentication -> Users if you want it fully gone.`
    );
  }
  rl.close();
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
