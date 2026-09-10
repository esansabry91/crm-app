// Web app config for the "ipsb-crm" Firebase project — the SAME project the rest of the CRM
// uses (see src/firebase.ts), and the same values public/duty-roster/firebase-config.js carries.
// These values are not secret; Firebase web configs are safe to ship in client code by design
// (they already appear in the CRM's own built JS bundle) — actual access control lives entirely
// in firestore.rules, not in hiding this file's contents.
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDEfWr-1xIIQcJ3VWPbLUOaLUPbVW03Dxs',
  authDomain: 'ipsb-crm.firebaseapp.com',
  projectId: 'ipsb-crm',
  storageBucket: 'ipsb-crm.firebasestorage.app',
  messagingSenderId: '665494186682',
  appId: '1:665494186682:web:f52a5ff2bfbdb0fd4ef083',
};
