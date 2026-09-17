/**
 * React-side `warnIfRosterUnlockedThenRun()` equivalent — ported from public/duty-roster/
 * index.html's warnIfRosterUnlockedThenRun()/openRosterUnlockedWarningModal() (lines ~4917-4965),
 * consuming the pure decision guidance lockMachine.ts's own `isNavigationBlockedByRoster()` doc
 * comment already lays out (steps 1-3 there). No postMessage/cross-frame concerns here either —
 * see lockMachine.ts's module doc comment for why that whole problem class doesn't exist once
 * Duty Roster is native React.
 *
 * Every in-page navigation this app can take while the Roster tab might be unlocked with pending
 * drags (switching site/client/branch, clicking another tab) should call `guard(proceed)` instead
 * of navigating directly. `RosterUnlockedWarningModal` (rendered by whatever page-level component
 * owns this hook — Task #22) reads `modalOpen`/`pendingCount` and calls `discard`/`lock`/`stay`.
 */
import { useCallback, useRef, useState } from "react";
import type { MonthState } from "../types";
import type { RosterSession } from "../rosterModel";
import { applyLock, applyDiscard, pendingDraftCount, type LockActionOutcome } from "../lockMachine";
import { canManageRosterLock, isRosterLocked } from "../rosterModel";

export interface UseUnlockGuardOptions {
  onPersist: (ms: MonthState, opts?: { suppressConfirmRevoke?: boolean }) => void;
  onToast: (message: string) => void;
}

export interface UseUnlockGuardResult {
  /** Whether the "Roster sheet is unlocked" modal should render right now. */
  modalOpen: boolean;
  /** The pending-drag count to show in the modal's message (0 while the modal is closed). */
  pendingCount: number;
  /** Wraps a navigation action: if the roster isn't actually pending, runs `proceed` immediately.
   * If it's pending but nothing's been dragged, silently re-locks (matches the original's
   * "nothing to lose, just re-lock and go" shortcut) and runs `proceed`. Otherwise opens the
   * warning modal and holds `proceed` until the user picks Discard or Lock — Stay/dismiss never
   * calls `proceed` at all. */
  guard: (ms: MonthState, session: RosterSession, proceed: () => void) => void;
  /** "Discard changes" button — discards the draft, re-locks, persists, then runs the held
   * `proceed`. */
  discard: () => void;
  /** "Lock roster" button — merges the draft in for real, persists, then runs the held
   * `proceed`. */
  lock: () => void;
  /** "Stay here" button, or a veil click — closes the modal without navigating. */
  stay: () => void;
}

export function useUnlockGuard({ onPersist, onToast }: UseUnlockGuardOptions): UseUnlockGuardResult {
  const [modalOpen, setModalOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef<{ ms: MonthState; session: RosterSession; proceed: () => void } | null>(null);

  const runOutcome = useCallback(
    (outcome: LockActionOutcome | null, andThen: (() => void) | null) => {
      if (outcome) {
        onPersist(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
        onToast(outcome.toast);
      }
      andThen?.();
    },
    [onPersist, onToast]
  );

  const guard = useCallback(
    (ms: MonthState, session: RosterSession, proceed: () => void) => {
      if (!canManageRosterLock(session) || isRosterLocked(ms)) {
        proceed();
        return;
      }
      const n = pendingDraftCount(ms);
      if (n === 0) {
        runOutcome(applyLock(ms, session), proceed);
        return;
      }
      pendingRef.current = { ms, session, proceed };
      setPendingCount(n);
      setModalOpen(true);
    },
    [runOutcome]
  );

  const discard = useCallback(() => {
    const held = pendingRef.current;
    pendingRef.current = null;
    setModalOpen(false);
    if (!held) return;
    runOutcome(applyDiscard(held.ms, held.session), held.proceed);
  }, [runOutcome]);

  const lock = useCallback(() => {
    const held = pendingRef.current;
    pendingRef.current = null;
    setModalOpen(false);
    if (!held) return;
    runOutcome(applyLock(held.ms, held.session), held.proceed);
  }, [runOutcome]);

  const stay = useCallback(() => {
    pendingRef.current = null;
    setModalOpen(false);
  }, []);

  return { modalOpen, pendingCount, guard, discard, lock, stay };
}
