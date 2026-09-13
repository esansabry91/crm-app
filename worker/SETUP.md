# Tender document storage — one-time setup

This backs the "upload tender document PDF" feature in Project Details (Active Projects) with
Backblaze B2 (free, no credit card) via a small Cloudflare Worker at `worker/index.ts`. The
Worker is deployed automatically together with the rest of the app (see `wrangler.toml`) — the
steps below are the one-time account setup that only a human with real credentials can do.
Nothing here is committed to git; every value is a Cloudflare secret or a Backblaze credential
you create yourself.

## 1. Create a Backblaze B2 account + bucket

1. Sign up at https://www.backblaze.com/sign-up/cloud-storage (no card required).
2. Create a bucket, e.g. `ipsb-crm-tender-docs`. Set it to **Private** — the app never links to
   B2 directly; every download goes through the Worker, which checks Firestore permissions first.
3. On the bucket's page, note its **Bucket Name** and **Bucket ID** (shown under bucket details).

## 2. Create a scoped Application Key

1. Go to **App Keys** → **Add a New Application Key**.
2. Name it something like `crm-app-worker`.
3. Restrict it to the one bucket you just created (don't use the master key here).
4. Capabilities needed: `listFiles`, `readFiles`, `writeFiles`, `deleteFiles`.
5. Backblaze shows the **keyID** and **applicationKey** exactly once — copy both now.

## 3. Create the Cloudflare KV namespace (cache only, not a source of truth)

From this project's folder, in your own Terminal (not through Claude — this needs your real
Cloudflare login):

```
npx wrangler login
npx wrangler kv namespace create DOC_CACHE
```

This prints an `id`. Open `wrangler.toml` and paste it into the `[[kv_namespaces]]` block where
it currently says `id = "REPLACE_WITH_KV_NAMESPACE_ID"`.

## 4. Set the Cloudflare secrets

Still in your own Terminal, from this project's folder:

```
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
```

Paste the keyID / applicationKey from step 2 when prompted for each. These never touch the repo,
wrangler.toml, or this chat.

## 5. Fill in the two plain (non-secret) values in wrangler.toml

Open `wrangler.toml` and replace the two placeholders in `[vars]`:
- `B2_BUCKET_ID` — the Bucket ID from step 1.
- `B2_BUCKET_NAME` — the Bucket Name from step 1.

(`FIREBASE_PROJECT_ID` is already filled in from `.env`'s `VITE_FIREBASE_PROJECT_ID` — no need to
touch it.)

## 6. Deploy

Push to the branch Cloudflare's dashboard builds from — its existing build command
(`npx wrangler deploy`) picks up everything above automatically. No other Cloudflare dashboard
setting needs to change.

## Rotating or revoking access later

- To rotate the B2 key: create a new Application Key in Backblaze, then re-run
  `npx wrangler secret put B2_KEY_ID` / `B2_APPLICATION_KEY` with the new values, then delete the
  old key in Backblaze.
- To cut off document access entirely without deleting anything: delete the Application Key in
  Backblaze — the Worker will start failing B2 calls immediately (uploads/downloads will error;
  nothing else in the app is affected).
