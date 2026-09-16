/**
 * Cross-frame bridge to the embedded Duty Roster console (public/duty-roster/index.html,
 * wrapped in an <iframe> by DutyRosterPage.tsx — see that file's own doc comment for why it's
 * an iframe rather than a ported React page). That page has its own "unlock the roster sheet,
 * drag tiles around, then Lock or Discard" flow (see index.html's warnIfRosterUnlockedThenRun())
 * that already warns before switching its own internal tabs or CLIENT SITE/CLIENT/BRANCH/Show
 * archived filters. This module extends that same warning to the CRM shell's OWN navigation —
 * the sidebar nav links and Sign out button in AppLayout.tsx — which live outside the iframe
 * and can't be reached by anything inside it.
 *
 * Same-origin postMessage in both directions:
 *  - index.html -> here: `{ source: "inter-prominent-duty-roster", type: "lock-status", pending }`,
 *    sent at the end of every render() there, so `currentlyPending` below is always current.
 *  - here -> index.html: `{ source: "inter-prominent-crm", type: "resolve-pending", action }`,
 *    telling it to actually lock or discard whatever it currently has unlocked — see
 *    resolveDutyRosterPending() below.
 *
 * A plain module-level singleton (not a React context) because AppLayout itself remounts on
 * every route change (see App.tsx's own comment on why — each <Route> wraps its own <AppLayout>
 * instance rather than one persistent layout with an <Outlet/>), while this file's state and
 * its one `message` listener persist for the page's whole lifetime, so a fresh AppLayout mount
 * after navigating away from and back to some page always picks up whatever the Duty Roster
 * iframe last reported, even if that iframe isn't the one currently on screen.
 */

const MESSAGE_SOURCE_FROM_DUTY_ROSTER = 'inter-prominent-duty-roster';
const MESSAGE_SOURCE_FROM_SHELL = 'inter-prominent-crm';

type PendingListener = (pending: boolean) => void;

let currentlyPending = false;
// The Duty Roster iframe's own `window` — captured from `event.source` on its lock-status
// messages (same-origin, so this is a live, directly usable reference), and how
// resolveDutyRosterPending() below reaches it. Never queried via the DOM (e.g.
// document.querySelector('iframe')) since AppLayout has no reason to know DutyRosterPage
// renders an iframe at all.
let dutyRosterWindow: Window | null = null;
const listeners = new Set<PendingListener>();

function notifyListeners() {
  listeners.forEach((listener) => listener(currentlyPending));
}

function handleMessage(event: MessageEvent) {
  if (event.origin !== window.location.origin) return;
  const data = event.data as { source?: string; type?: string; pending?: unknown } | null;
  if (!data || data.source !== MESSAGE_SOURCE_FROM_DUTY_ROSTER || data.type !== 'lock-status') return;
  dutyRosterWindow = event.source as Window;
  const pending = Boolean(data.pending);
  if (pending !== currentlyPending) {
    currentlyPending = pending;
    notifyListeners();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', handleMessage);
}

/** Subscribes to pending-status changes; calls `listener` immediately with the current value
 *  (so a freshly-mounted AppLayout doesn't have to wait for the next message to know where
 *  things stand), then again on every change. Returns an unsubscribe function. */
export function subscribeDutyRosterPending(listener: PendingListener): () => void {
  listeners.add(listener);
  listener(currentlyPending);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Safety net for leaving /duty-roster any way OTHER than the gated nav links/Sign out button
 * (typing a new URL, the browser back/forward buttons, closing the tab) — those bypass
 * AppLayout's guard entirely, so without this, a stale "pending: true" could wrongly warn on
 * some later, unrelated page. Called from DutyRosterPage's own unmount cleanup. The gated exits
 * already resolve pending to false themselves (see resolveDutyRosterPending()) before
 * navigating, so this is a backstop, not the primary mechanism.
 */
export function resetDutyRosterPending(): void {
  dutyRosterWindow = null;
  if (currentlyPending) {
    currentlyPending = false;
    notifyListeners();
  }
}

/**
 * Tells the Duty Roster iframe to resolve whatever it currently has unlocked — 'lock' applies
 * the pending drag changes, 'discard' throws them away (and re-locks either way; see
 * index.html's discardDraftChanges()). No-op if the iframe isn't around to hear it, which
 * shouldn't happen in practice: this is only ever called while that same iframe's own
 * lock-status message is what's driving the warning that offers these two choices.
 */
export function resolveDutyRosterPending(action: 'lock' | 'discard'): void {
  dutyRosterWindow?.postMessage(
    { source: MESSAGE_SOURCE_FROM_SHELL, type: 'resolve-pending', action },
    window.location.origin
  );
}
