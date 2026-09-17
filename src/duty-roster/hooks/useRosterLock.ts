/**
 * Wires the pure lock/unlock/draft/discard/drag-swap reducers (lockMachine.ts) to a live
 * useMonthState() subscription — the hook a Roster Sheet component actually calls. This is the
 * direct replacement for the original's lockRoster()/unlockRoster()/discardDraftChanges()/
 * performDragSwap() acting on the module-level `state`/`currentMonthState()` singleton: here the
 * "current month" is whatever useMonthState(siteId, monthKey) is subscribed to, and every action
 * is a read-reduce-persist cycle instead of an in-place mutation.
 */
import { useCallback, useMemo } from "react";
import type { MonthState } from "../types";
import type { RosterSession } from "../rosterModel";
import { isRosterLocked, canManageRosterLock, monthDraftOverrides } from "../rosterModel";
import {
  applyDiscard,
  applyLock,
  applyUnlock,
  computeDragSwap,
  currentMonthStateForRosterDisplay,
  isNavigationBlockedByRoster,
  pendingDraftCount,
  type SlotRef,
} from "../lockMachine";
import type { GenerateMonthConfig } from "../schedulingEngine";
import { useMonthState } from "./useMonthState";

export interface UseRosterLockResult {
  ms: MonthState | null;
  loading: boolean;
  /** ms with any in-progress draft merged on top, for the grid's own render only — see
   * currentMonthStateForRosterDisplay()'s doc comment in lockMachine.ts. */
  displayMs: MonthState | null;
  /** The underlying useMonthState() persist, re-exposed so a caller that also needs generic
   * "save this MonthState" access (every other tab's own edits — Guards & Shifts, Adjustments,
   * Summary Report) can share this hook's single onSnapshot subscription instead of opening a
   * second one via its own separate useMonthState(siteId, monthKey) call. */
  persist: (next: MonthState, opts?: { suppressConfirmRevoke?: boolean }) => Promise<void>;
  locked: boolean;
  canManage: boolean;
  pendingCount: number;
  /** True while this roster is unlocked (regardless of whether anything's been dragged yet) and
   * the signed-in user is one of the roles who can manage the lock — the same condition the
   * in-page navigation guard (warnIfRosterUnlockedThenRun()'s equivalent, Task #22) should check
   * before letting the user switch site/tab/filter away from this roster. */
  navigationBlocked: boolean;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  discard: () => Promise<void>;
  dragSwap: (src: SlotRef, dest: SlotRef) => Promise<void>;
}

export function useRosterLock(
  siteId: string | null,
  monthKey: string | null,
  session: RosterSession,
  y: number,
  m: number,
  config: GenerateMonthConfig | null
): UseRosterLockResult {
  const { ms, loading, persist } = useMonthState(siteId, monthKey);

  const displayMs = useMemo(() => (ms ? currentMonthStateForRosterDisplay(ms) : null), [ms]);

  const lock = useCallback(async () => {
    if (!ms) return;
    const outcome = applyLock(ms, session);
    if (!outcome) return;
    await persist(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
  }, [ms, session, persist]);

  const unlock = useCallback(async () => {
    if (!ms) return;
    const outcome = applyUnlock(ms, session);
    if (!outcome) return;
    await persist(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
  }, [ms, session, persist]);

  const discard = useCallback(async () => {
    if (!ms) return;
    const outcome = applyDiscard(ms, session);
    if (!outcome) return;
    await persist(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
  }, [ms, session, persist]);

  const dragSwap = useCallback(
    async (src: SlotRef, dest: SlotRef) => {
      if (!ms || !config) return;
      const outcome = computeDragSwap(y, m, config, ms, session, src, dest);
      if (!outcome) return;
      await persist(outcome.ms, { suppressConfirmRevoke: outcome.suppressConfirmRevoke });
    },
    [ms, config, session, y, m, persist]
  );

  return {
    ms,
    loading,
    displayMs,
    persist,
    locked: ms ? isRosterLocked(ms) : true,
    canManage: canManageRosterLock(session),
    pendingCount: ms ? pendingDraftCount(ms) : 0,
    navigationBlocked: ms ? isNavigationBlockedByRoster(ms, session) : false,
    lock,
    unlock,
    discard,
    dragSwap,
  };
}

// Re-exported so callers of this hook don't also need to import monthDraftOverrides directly
// for simple "is there a pending draft" checks outside the count above.
export { monthDraftOverrides };
