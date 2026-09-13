import { auth } from '../firebase';

/**
 * Client for the /api/tenders/:id/document Worker route (see worker/index.ts) — the one backend
 * endpoint in this app. Every call sends the current user's own Firebase ID token; the Worker
 * re-checks Firestore's normal read/update rules with that SAME token before touching Backblaze
 * B2, so this file has no permission logic of its own — a rejected request just surfaces
 * whatever message the Worker/Firestore gave back.
 *
 * Deliberately separate from services/tenders.ts: that file talks to Firestore directly via the
 * SDK, this one talks to the Worker via fetch(). The Worker itself writes the resulting
 * tenderDocument* fields onto the tender doc, so callers here don't need to also call
 * updateActiveProjectDetails() — the realtime Firestore listener elsewhere in the app (Active
 * Projects) picks up the change on its own; the return value below is just for updating this
 * modal's own local state immediately, without waiting on that round trip.
 */

export interface TenderDocumentInfo {
  tenderDocumentName: string;
  tenderDocumentSize: number;
  tenderDocumentUploadedAt: number;
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in.');
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function readErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    const body = (await resp.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

/** Uploads (or replaces) the tender document PDF. Throws with a user-facing message on failure. */
export async function uploadTenderDocument(tenderId: string, file: File): Promise<TenderDocumentInfo> {
  const headers = await authHeader();
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/document`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp, 'Could not upload the document.'));
  return resp.json();
}

/**
 * Fetches the document as a Blob and opens it in a new tab. Uses a Blob + object URL (rather
 * than pointing the tab straight at the API URL) because the request needs an Authorization
 * header, which a plain link/window.open can't attach.
 */
export async function openTenderDocument(tenderId: string): Promise<void> {
  const headers = await authHeader();
  const resp = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/document`, { headers });
  if (!resp.ok) throw new Error(await readErrorMessage(resp, 'Could not open the document.'));
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Give the new tab a moment to actually load the blob before revoking it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Deletes the uploaded document (both the Firestore fields and the underlying B2 file). */
export async function deleteTenderDocument(tenderId: string): Promise<void> {
  const headers = await authHeader();
  const resp = await fetch(`/api/tenders/${encodeURIComponent(tenderId)}/document`, {
    method: 'DELETE',
    headers,
  });
  if (!resp.ok) throw new Error(await readErrorMessage(resp, 'Could not delete the document.'));
}
