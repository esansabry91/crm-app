# Global Density — Tender Pipeline CRM

An internal CRM for tracking your sales funnel / tender pipeline across branches and brands.

- **Kanban pipeline board**: New Lead → Qualified Lead → Prepare Proposal → Submitted → Negotiation → Won → Lost, drag-and-drop between stages.
- **Tender registration**: client name, brand, department (branch or HQ), contract period, tender value (RM), owner.
- **Performance analysis**: total pipeline value trend over time, tender count & value per stage, won vs lost, total pipeline value vs won value, performance by brand (with a combined total across all 3 brands), and tender-staff performance (HQ Admin only).
- **Role-based access**: Staff can only see and manage their own tenders. HQ Admin / Superior sees and manages everything, and manages team accounts, branches and brands.
- **Stack**: React + Vite + TypeScript + Tailwind, Firebase (Authentication + Firestore) for the backend, deployed as a static site on Cloudflare Pages.

This app talks to Firebase directly from the browser — there is no server component to run or pay for beyond Firebase itself (free "Spark" plan is enough) and Cloudflare Pages (free tier is enough).

---

## 1. Prerequisites

- Node.js 18+ and npm
- A Google account (for Firebase)
- A Cloudflare account (for hosting)

---

## 2. Create your Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) → **Add project** → give it a name (e.g. `global-density-crm`) → finish the wizard (Google Analytics is optional, you can skip it).
2. **Enable Authentication**: left sidebar → *Build* → *Authentication* → *Get started* → under *Sign-in method*, enable **Email/Password**.
3. **Create Firestore**: left sidebar → *Build* → *Firestore Database* → *Create database* → start in **production mode** → pick a region close to Malaysia (e.g. `asia-southeast1 (Singapore)`) → *Enable*.
4. **Register a Web App**: *Project settings* (gear icon) → *General* tab → scroll to *Your apps* → click the `</>` (Web) icon → give it a nickname → *Register app*. Firebase shows you a `firebaseConfig` object — you'll need these values in step 4 below.

---

## 3. Configure the project locally

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in the values from the `firebaseConfig` object you just saw:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Run it locally:

```bash
npm run dev
```

It won't let you sign in yet — you need to deploy security rules and create your first admin account first (next two steps).

---

## 4. Deploy the Firestore security rules

The rules in `firestore.rules` are what enforce "staff only see their own tenders, admin sees everything" — they matter as much as the app code, so don't skip this.

**Option A — Firebase CLI (recommended):**

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your Firebase project when prompted
firebase deploy --only firestore:rules,firestore:indexes
```

**Option B — paste manually:** Firebase console → *Firestore Database* → *Rules* tab → paste the contents of `firestore.rules` → *Publish*. (You'll also want the composite indexes in `firestore.indexes.json` — Firestore will otherwise show you a link to auto-create each one the first time a query needs it, which also works fine.)

---

## 5. Create your first HQ Admin account (one-time, manual)

Every other account in the app gets created *from inside the app* by an admin — but the very first admin has to be created by hand, directly in Firebase, since no admin exists yet to do it for you.

1. Firebase console → *Authentication* → *Users* tab → *Add user* → enter your email and a password. After it's created, **copy its User UID** (shown in the users list).
2. Firebase console → *Firestore Database* → *Data* tab → *Start collection* → collection ID: `users` → **Document ID: paste the UID you just copied** (this is important — the document ID must exactly match the Auth UID) → add these fields:

   | Field | Type | Value |
   |---|---|---|
   | `name` | string | your name |
   | `email` | string | same email you used above |
   | `role` | string | `admin` |
   | `department` | string | `HQ` |
   | `active` | boolean | `true` |
   | `createdAt` | number | `1` (any number is fine, it's just for display) |

3. Save. You can now sign in to the app with that email/password and land on the Pipeline board as HQ Admin.

From here on, use **Admin Settings → Team** inside the app to create every other staff/admin account — it handles the Firebase Auth account and the Firestore profile together, correctly, without booting you out of your own session.

---

## 6. Seed your branches and brands

Log in as admin → **Admin Settings → Branches & Brands**:

- Add your branches (department is "HQ" plus whatever branches you add here — e.g. "Penang Branch", "Kelantan Branch").
- Add your 3 brands. Every tender gets assigned to one of them, which is what powers the "performance by brand" breakdown.

Then **Admin Settings → Team** to create accounts for your staff, assigning each one's role (Staff / HQ Admin) and department.

---

## 7. Deploy to Cloudflare Pages

Build output goes to `dist/`; `public/_redirects` is already included so client-side routing works correctly on Cloudflare Pages.

**Option A — Git integration (recommended, auto-deploys on every push):**

1. Push this project to a GitHub/GitLab repo.
2. Cloudflare dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → pick the repo.
3. Build settings: **Build command** `npm run build`, **Build output directory** `dist`.
4. Under *Settings → Environment variables*, add the same six `VITE_FIREBASE_*` variables from your `.env` (for both Production and Preview).
5. Deploy.

**Option B — Wrangler CLI:**

```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist --project-name=global-density-crm
```

**One more Firebase step after deploying:** Firebase Authentication only allows sign-in requests from domains you've explicitly authorized. Go to Firebase console → *Authentication → Settings → Authorized domains* → **add your Cloudflare Pages domain** (e.g. `global-density-crm.pages.dev`, and your custom domain if you attach one). Skipping this causes an `auth/unauthorized-domain` error on the live site.

---

## How access control works

- **Staff**: can create tenders (always owned by themselves), see and edit only their own tenders, and see analytics computed only from their own tenders.
- **HQ Admin / Superior**: sees and can edit every tender, manages team accounts, branches and brands, and is the only role that sees the cross-staff "Tender Staff Performance" comparison.
- This is enforced in two places, deliberately redundant: the UI only *shows* what a role should see, and `firestore.rules` independently enforces the same boundaries at the database level — so it holds even if someone bypassed the UI.
- Deactivating a team member (Admin Settings → Team → Deactivate) blocks their access immediately without deleting their tender history. It does not delete their Firebase Auth login — that requires the Firebase console (Authentication tab → find the user → delete), since deleting arbitrary Auth accounts needs the Admin SDK, which is out of scope for a client-only app like this one.

## How the pipeline-value trend is calculated

Every tender create / stage change / value change / delete is logged to an per-tender `history` subcollection. The trend chart replays that whole log in chronological order to reconstruct what the total open-pipeline and won value looked like at each point in time — it's a real historical reconstruction, not just "tenders created this month."

## Data model (Firestore collections)

- `users/{uid}` — `name`, `email`, `role` (`admin`|`staff`), `department`, `active`, `createdAt`
- `branches/{id}` — `name`, `createdAt`
- `brands/{id}` — `name`, `createdAt`
- `tenders/{id}` — `clientName`, `brandId`, `brandName`, `department`, `contractStart`, `contractEnd`, `tenderValue`, `stage`, `ownerUid`, `ownerName`, `notes`, `createdAt`, `updatedAt`
  - `tenders/{id}/history/{id}` — `type`, `stage`, `value`, `ownerUid`, `changedByUid`, `changedByName`, `timestamp`, `fromStage?`

## Project structure

```
src/
  contexts/AuthContext.tsx     Firebase auth + user profile state
  services/                    All Firestore writes (tenders, branches/brands, users)
  hooks/                       Firestore subscriptions (real-time reads)
  utils/analytics.ts           All the aggregation math behind the analysis page
  utils/vizColors.ts           Chart color tokens
  components/kanban/           The drag-and-drop pipeline board
  components/tenders/          The tender registration/edit form
  components/analytics/        Every chart + table on the Performance Analysis page
  components/admin/            Team, branch & brand management
  pages/                       One file per route
firestore.rules                Server-side access control — read this alongside "How access control works" above
firestore.indexes.json         Composite indexes the app's queries need
```

## Known limitations / good next steps

- Deleting a tender is soft-guarded (it logs a final history entry first so it stops counting toward the trend chart) but its old `history` rows are left in Firestore rather than being purged — harmless, just unused storage.
- There's no self-serve "forgot password" flow yet — add `sendPasswordResetEmail` from the Firebase Auth SDK to the login page if you want one.
- The production JS bundle is a single ~1.3MB file (no code-splitting yet). Fine for an internal tool used by a small team; worth revisiting with route-based `React.lazy()` if the app grows a lot more.
- Removing a team member's Firebase Auth login (not just deactivating their CRM access) currently requires the Firebase console, as noted above.
