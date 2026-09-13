/**
 * Cloudflare Worker: tender-document upload/download/delete API.
 *
 * This file is the ONLY backend code in the project — everything else is the static React
 * app served straight out of `dist/` (see wrangler.toml's [assets] block). `run_worker_first =
 * ["/api/*"]` there means only requests under /api/* ever reach this script; everything else
 * (the whole React app) is served as a static file exactly as before, untouched.
 *
 * Why this exists: tender documents (PDFs) can't go straight from the browser to Backblaze B2,
 * because that would mean putting a B2 secret key in client-side JS where anyone could steal it.
 * Instead the browser sends the file here with the user's own Firebase ID token, this Worker
 * checks that token, asks Firestore (using that SAME token, not a service account) whether the
 * caller is actually allowed to touch this tender's document fields, and only then talks to B2
 * using a secret key that never leaves this server. That "ask Firestore with the caller's own
 * token" trick means firestore.rules — already correct and already tested — is the ONE place
 * that decides who can upload/view/delete a document. This file has no authorization logic of
 * its own to keep in sync with the rules file; it just forwards the caller's credentials.
 *
 * Deliberately dependency-free (no `npm install` needed for any of this):
 *  - Firebase ID tokens are verified by hand with the Web Crypto API (crypto.subtle) against
 *    Google's public signing keys, instead of the `firebase-auth-cloudflare-workers` package.
 *  - Backblaze is talked to via B2's own "native" API (simple bearer-token auth) instead of its
 *    S3-compatible API, which would need an AWS SigV4 signing library.
 * See worker/SETUP.md for the one-time account setup (Backblaze bucket/key, Cloudflare KV
 * namespace, Wrangler secrets) that has to happen before this works.
 */

export interface Env {
  // Plain var (not secret) — same Firebase project the frontend uses; see .env's
  // VITE_FIREBASE_PROJECT_ID. Set in wrangler.toml's [vars].
  FIREBASE_PROJECT_ID: string;
  // KV namespace used purely as a cache (Google's signing keys, our B2 account auth token) —
  // never the source of truth for anything. Typed as `any` rather than the real `KVNamespace`
  // type so this file needs no @cloudflare/workers-types install; Wrangler runs this through
  // esbuild, not tsc, so the loose typing costs nothing at runtime. See worker/SETUP.md.
  DOC_CACHE: any;
  // Secrets — set with `wrangler secret put <NAME>`, never written into this repo or wrangler.toml.
  B2_KEY_ID: string;
  B2_APPLICATION_KEY: string;
  // Plain vars — not secret, just identifiers. Set in wrangler.toml's [vars].
  B2_BUCKET_ID: string;
  B2_BUCKET_NAME: string;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — comfortable for a scanned tender document.

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/tenders\/([^/]+)\/document\/?$/);
    if (!match) return new Response('Not found', { status: 404 });
    const tenderId = decodeURIComponent(match[1]);

    try {
      if (request.method === 'POST') return await handleUpload(request, env, tenderId);
      if (request.method === 'GET') return await handleDownload(request, env, tenderId);
      if (request.method === 'DELETE') return await handleDelete(request, env, tenderId);
      return json({ error: 'Method not allowed' }, 405);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('tender-document API error:', err);
      return json({ error: 'Internal error' }, 500);
    }
  },
};

// ==================== Route handlers ====================

async function handleUpload(request: Request, env: Env, tenderId: string): Promise<Response> {
  const idToken = getBearerToken(request);
  await verifyFirebaseIdToken(idToken, env);

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'No file provided');
  if (file.size === 0) throw new HttpError(400, 'File is empty');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`);
  }
  if (file.type && file.type !== 'application/pdf') {
    throw new HttpError(400, 'Only PDF files are accepted');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // A PDF always starts with "%PDF" — cheap sanity check independent of the browser-reported
  // MIME type (which is trivially wrong/absent for some upload sources).
  const looksLikePdf =
    bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!looksLikePdf) throw new HttpError(400, 'File does not look like a valid PDF');

  // Read the tender BEFORE uploading anything, using the caller's own token — this is a real
  // Firestore read, so it 403s here (cheaply, before touching B2) if the caller can't even see
  // this tender. Also gives us the previous document's key/fileId so we can clean it up after a
  // successful replace, instead of leaving orphaned files in the bucket forever.
  const existing = await firestoreGetTender(env, idToken, tenderId);
  const previousKey = fsString(existing, 'tenderDocumentKey');
  const previousFileId = fsString(existing, 'tenderDocumentFileId');

  const auth = await b2Authorize(env);
  const uploadUrl = await b2GetUploadUrl(auth, env.B2_BUCKET_ID);

  const safeName = sanitizeFileName(file.name || 'document.pdf');
  const key = `tenders/${tenderId}/${Date.now()}-${safeName}`;
  const sha1 = await sha1Hex(bytes);

  const uploadResp = await fetch(uploadUrl.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: uploadUrl.authorizationToken,
      'X-Bz-File-Name': b2EncodeFileName(key),
      'Content-Type': 'application/pdf',
      'X-Bz-Content-Sha1': sha1,
      'Content-Length': String(bytes.byteLength),
    },
    body: bytes,
  });
  if (!uploadResp.ok) {
    const detail = await uploadResp.text().catch(() => '');
    throw new HttpError(502, `Backblaze upload failed: ${detail.slice(0, 200)}`);
  }
  const uploaded = (await uploadResp.json()) as { fileId: string };

  const uploadedAt = Date.now();
  try {
    // This PATCH is the actual authorization check for the write: it's sent with the CALLER's
    // token, so firestore.rules decides whether they're allowed to set these fields on this
    // tender. If they're not, this throws and the catch below deletes the file we just uploaded.
    await firestorePatchTenderDocument(env, idToken, tenderId, {
      tenderDocumentKey: key,
      tenderDocumentFileId: uploaded.fileId,
      tenderDocumentName: file.name || safeName,
      tenderDocumentSize: bytes.byteLength,
      tenderDocumentUploadedAt: uploadedAt,
    });
  } catch (err) {
    await b2DeleteFileVersion(auth, key, uploaded.fileId).catch(() => {});
    throw err;
  }

  // Best-effort cleanup of the file this one replaced — never lets a cleanup failure fail the
  // request, since the new document is already safely saved at this point.
  if (previousKey && previousFileId && previousKey !== key) {
    await b2DeleteFileVersion(auth, previousKey, previousFileId).catch((err) =>
      console.error('Could not delete replaced tender document:', err)
    );
  }

  return json({
    tenderDocumentName: file.name || safeName,
    tenderDocumentSize: bytes.byteLength,
    tenderDocumentUploadedAt: uploadedAt,
  });
}

async function handleDownload(request: Request, env: Env, tenderId: string): Promise<Response> {
  const idToken = getBearerToken(request);
  await verifyFirebaseIdToken(idToken, env);

  // Same trick as the upload path: a plain Firestore read with the caller's own token, so
  // firestore.rules' existing /tenders read rule is what decides who can view this document.
  const fields = await firestoreGetTender(env, idToken, tenderId);
  const key = fsString(fields, 'tenderDocumentKey');
  const name = fsString(fields, 'tenderDocumentName') || 'tender-document.pdf';
  if (!key) throw new HttpError(404, 'No document has been uploaded for this tender');

  const auth = await b2Authorize(env);
  const downloadResp = await fetch(
    `${auth.downloadUrl}/file/${encodeURIComponent(env.B2_BUCKET_NAME)}/${b2EncodeFileName(key)}`,
    { headers: { Authorization: auth.authorizationToken } }
  );
  if (!downloadResp.ok || !downloadResp.body) {
    throw new HttpError(502, 'Could not fetch document from storage');
  }

  return new Response(downloadResp.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${name.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
    },
  });
}

async function handleDelete(request: Request, env: Env, tenderId: string): Promise<Response> {
  const idToken = getBearerToken(request);
  await verifyFirebaseIdToken(idToken, env);

  const existing = await firestoreGetTender(env, idToken, tenderId);
  const key = fsString(existing, 'tenderDocumentKey');
  const fileId = fsString(existing, 'tenderDocumentFileId');
  if (!key) return json({ ok: true }); // nothing to delete

  // Clearing the fields is the real authorization check (caller's own token, firestore.rules
  // decides) — only delete the B2 object once Firestore has actually accepted the clear.
  await firestorePatchTenderDocument(env, idToken, tenderId, {
    tenderDocumentKey: null,
    tenderDocumentFileId: null,
    tenderDocumentName: null,
    tenderDocumentSize: null,
    tenderDocumentUploadedAt: null,
  });

  if (fileId) {
    const auth = await b2Authorize(env);
    await b2DeleteFileVersion(auth, key, fileId).catch((err) =>
      console.error('Firestore fields cleared but B2 delete failed (orphaned file):', err)
    );
  }

  return json({ ok: true });
}

// ==================== Firebase ID token verification ====================
// Verifies the token by hand against Google's public JWKS, instead of pulling in the
// `firebase-auth-cloudflare-workers` package — see the file header comment.

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_CACHE_KEY = 'firebase-jwks';

interface FirebaseClaims {
  uid: string;
  email?: string;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

async function getGoogleJwks(env: Env): Promise<{ keys: any[] }> {
  const cached = await env.DOC_CACHE.get(JWKS_CACHE_KEY, 'json');
  if (cached) return cached;
  const resp = await fetch(GOOGLE_JWKS_URL);
  if (!resp.ok) throw new HttpError(502, 'Could not fetch Google signing keys');
  const jwks = await resp.json();
  // Google rotates these every few hours; an hour of caching is generous without ever getting
  // stuck on a retired key for long.
  await env.DOC_CACHE.put(JWKS_CACHE_KEY, JSON.stringify(jwks), { expirationTtl: 3600 });
  return jwks as { keys: any[] };
}

async function verifyFirebaseIdToken(idToken: string, env: Env): Promise<FirebaseClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Malformed token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = base64UrlDecodeJson(headerB64);
  const payload = base64UrlDecodeJson(payloadB64);

  if (header.alg !== 'RS256') throw new HttpError(401, 'Unexpected token algorithm');

  const jwks = await getGoogleJwks(env);
  const jwk = jwks.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Unknown signing key (try again — Google may have rotated keys)');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(sigB64);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) throw new HttpError(401, 'Invalid token signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new HttpError(401, 'Token expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new HttpError(401, 'Token not yet valid');
  if (payload.aud !== env.FIREBASE_PROJECT_ID) throw new HttpError(401, 'Token audience mismatch');
  if (payload.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) {
    throw new HttpError(401, 'Token issuer mismatch');
  }
  if (!payload.sub || typeof payload.sub !== 'string') throw new HttpError(401, 'Token missing subject');

  return { uid: payload.sub, email: payload.email };
}

function getBearerToken(request: Request): string {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) throw new HttpError(401, 'Missing Authorization header');
  return m[1];
}

// ==================== Firestore REST helpers ====================
// Every call here is made with the CALLER's OWN Firebase ID token (never a service account),
// so firestore.rules evaluates it exactly as if the browser had written to Firestore directly.
// This Worker deliberately has no authorization logic of its own beyond this.

function firestoreBase(projectId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function firestoreGetTender(
  env: Env,
  idToken: string,
  tenderId: string
): Promise<Record<string, any>> {
  const resp = await fetch(`${firestoreBase(env.FIREBASE_PROJECT_ID)}/tenders/${tenderId}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (resp.status === 404) throw new HttpError(404, 'Tender not found');
  if (!resp.ok) throw new HttpError(403, 'Not authorized to view this tender');
  const doc = (await resp.json()) as { fields?: Record<string, any> };
  return doc.fields || {};
}

function fsString(fields: Record<string, any>, key: string): string | undefined {
  return fields[key]?.stringValue;
}

interface TenderDocumentFields {
  tenderDocumentKey: string | null;
  tenderDocumentFileId: string | null;
  tenderDocumentName: string | null;
  tenderDocumentSize: number | null;
  tenderDocumentUploadedAt: number | null;
}

async function firestorePatchTenderDocument(
  env: Env,
  idToken: string,
  tenderId: string,
  fields: TenderDocumentFields
): Promise<void> {
  const fieldNames = [
    'tenderDocumentKey',
    'tenderDocumentFileId',
    'tenderDocumentName',
    'tenderDocumentSize',
    'tenderDocumentUploadedAt',
    'updatedAt',
  ];
  const mask = fieldNames.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');

  const toValue = (v: string | number | null, kind: 'string' | 'integer') => {
    if (v == null) return { nullValue: null };
    return kind === 'string' ? { stringValue: v } : { integerValue: String(v) };
  };

  const body = {
    fields: {
      tenderDocumentKey: toValue(fields.tenderDocumentKey, 'string'),
      tenderDocumentFileId: toValue(fields.tenderDocumentFileId, 'string'),
      tenderDocumentName: toValue(fields.tenderDocumentName, 'string'),
      tenderDocumentSize: toValue(fields.tenderDocumentSize, 'integer'),
      tenderDocumentUploadedAt: toValue(fields.tenderDocumentUploadedAt, 'integer'),
      updatedAt: { integerValue: String(Date.now()) },
    },
  };

  const resp = await fetch(`${firestoreBase(env.FIREBASE_PROJECT_ID)}/tenders/${tenderId}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new HttpError(
      resp.status === 403 ? 403 : 500,
      resp.status === 403
        ? "You don't have permission to change this tender's document."
        : `Firestore update failed: ${detail.slice(0, 200)}`
    );
  }
}

// ==================== Backblaze B2 native API helpers ====================
// Uses B2's own simple bearer-token API (not its S3-compatible one), so no AWS SigV4 signing
// library is needed. See worker/SETUP.md for how to create the bucket + Application Key.

interface B2Auth {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
}

const B2_AUTH_CACHE_KEY = 'b2-auth';

async function b2Authorize(env: Env): Promise<B2Auth> {
  const cached = await env.DOC_CACHE.get(B2_AUTH_CACHE_KEY, 'json');
  if (cached) return cached as B2Auth;

  const credentials = btoa(`${env.B2_KEY_ID}:${env.B2_APPLICATION_KEY}`);
  const resp = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new HttpError(502, `Could not authorize with Backblaze B2: ${detail.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  const auth: B2Auth = {
    apiUrl: data.apiInfo.storageApi.apiUrl,
    downloadUrl: data.apiInfo.storageApi.downloadUrl,
    authorizationToken: data.authorizationToken,
  };
  // The real token is valid ~24h; cache for less than that so a request is never stuck retrying
  // a token that's about to expire.
  await env.DOC_CACHE.put(B2_AUTH_CACHE_KEY, JSON.stringify(auth), { expirationTtl: 6 * 3600 });
  return auth;
}

async function b2GetUploadUrl(
  auth: B2Auth,
  bucketId: string
): Promise<{ uploadUrl: string; authorizationToken: string }> {
  const resp = await fetch(`${auth.apiUrl}/b2api/v4/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'content-type': 'application/json' },
    body: JSON.stringify({ bucketId }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new HttpError(502, `Could not get a Backblaze upload URL: ${detail.slice(0, 200)}`);
  }
  return resp.json();
}

async function b2DeleteFileVersion(auth: B2Auth, fileName: string, fileId: string): Promise<void> {
  const resp = await fetch(`${auth.apiUrl}/b2api/v4/b2_delete_file_version`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'content-type': 'application/json' },
    body: JSON.stringify({ fileName, fileId }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`b2_delete_file_version failed: ${detail.slice(0, 200)}`);
  }
}

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'document.pdf';
}

// B2 percent-encodes file names in the X-Bz-File-Name header and in download URLs, but expects
// "/" left UN-encoded so its (purely cosmetic) folder view in the web console still works and,
// more importantly, so the SAME encoding is used consistently everywhere this key is referenced
// — encoding the slashes here previously caused upload and download to disagree on the literal
// file name.
function b2EncodeFileName(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
