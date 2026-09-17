/**
 * Roster sheet lock / unlock / draft / discard / drag-swap state machine — ported from
 * public/duty-roster/index.html's lockRoster()/unlockRoster()/discardDraftChanges()/
 * performDragSwap() (lines ~5623-5759) and currentMonthStateForRosterDisplay() (line ~1407).
 *
 * Architectural change from the original (deliberate, not an oversight): the legacy console
 * needed a `suppressLockStatusPost` flag + a cross-frame postMessage handshake
 * (postLockStatusToParent() / the "resolve-pending" listener) purely to work around the fact
 * that the CRM shell and the roster lived in different iframes and could only coordinate
 * asynchronously — that's what caused the race condition fixed earlier this engagement (a
 * fire-and-forget Firestore write racing the shell's navigate-away). Once Duty Roster is native
 * React in the same tree as the shell, that whole problem class disappears: "is this roster
 * pending" is just a piece of React state the navigation guard reads directly and synchronously
 * — no postMessage, no suppress flag, no race window. So this module intentionally has NO
 * equivalent of postLockStatusToParent()/suppressLockStatusPost/the message listener; the
 * pending/lock state it produces is meant to be read straight off the hook that owns it (Task
 * #22 wires that into the router's leave-guard).
 *
 * Every function here is a pure reducer: (state in) -> (state out) + a side-effect descriptor
 * (log line to append, toast text, whether a persist is needed). No Firestore calls, no
 * `render()`, no DOM — those belong to the hook/component layer that calls these.
 */
import type { MonthState } from "./types";
import { canManageRosterLock, isRosterLocked, monthDraftOverrides } from "./rosterModel";
import type { RosterSession } from "./rosterModel";
import { MAX_LOG_ENTRIES } from "./types";
import { nowIso } from "./rosterModel";
import { generateMonth } from "./schedulingEngine";
import type { GenerateMonthConfig } from "./schedulingEngine";
import { computeShiftDefsForDay } from "./shiftStructure";
import { dowMon } from "./dateUtils";

/** Appends a log line to a MonthState, trimming to the most recent MAX_LOG_ENTRIES — same
 * behavior as the original addLog(). Returns a new MonthState (does not mutate the input). */
export function appendLog(ms: MonthState, text: string): MonthState {
  let log = [...ms.log, { ts: nowIso(), text }];
  if (log.length > MAX_LOG_ENTRIES) log = log.slice(-MAX_LOG_ENTRIES);
  return { ...ms, log };
}

export interface LockActionOutcome {
  /** The updated month state to persist (via whatever save call the hook layer uses). */
  ms: MonthState;
  toast: string;
  /** Whether the persist call should pass `{ suppressConfirmRevoke: true }` (see
   * useMonthState.ts's persist()). Matches the original exactly: lockRoster()/unlockRoster()
   * both persist via the NORMAL path (persistMonth() — confirmation IS revoked), because
   * committing the draft, or opening the roster up for rearranging, both mean the schedule may
   * have genuinely changed or is about to. discardDraftChanges()/performDragSwap() both persist
   * via persistDraftChange() (suppressConfirmRevoke: true) — a draft that's been thrown away
   * never touched ms.overrides, and an in-progress (not yet locked-in) drag isn't a committed
   * change either, so neither should invalidate an existing confirmation. */
  suppressConfirmRevoke: boolean;
}

/** lockRoster() — merges the in-progress draft into the real overrides, clears the draft, and
 * re-locks. A safe no-op merge when the draft is empty (used by warnIfRosterUnlockedThenRun()'s
 * "nothing to lose, just re-lock" path). Returns null when the actor isn't allowed to manage the
 * lock, or the roster is already locked (matching the original's early returns). */
export function applyLock(ms: MonthState, session: RosterSession): LockActionOutcome | null {
  if (!canManageRosterLock(session)) return null;
  if (isRosterLocked(ms)) return null;
  const draft = monthDraftOverrides(ms);
  const n = Object.keys(draft).length;
  let next: MonthState = {
    ...ms,
    overrides: { ...ms.overrides, ...draft },
    draftOverrides: {},
    rosterLocked: true,
  };
  next = appendLog(next, n > 0 ? `Locked the roster sheet — applied ${n} drag rearrangement${n === 1 ? "" : "s"}.` : "Locked the roster sheet.");
  return { ms: next, toast: "Roster locked.", suppressConfirmRevoke: false };
}

/** unlockRoster() — flips rosterLocked to false so drag-to-swap becomes available. Returns null
 * when not allowed, or already unlocked. */
export function applyUnlock(ms: MonthState, session: RosterSession): LockActionOutcome | null {
  if (!canManageRosterLock(session)) return null;
  if (!isRosterLocked(ms)) return null;
  let next: MonthState = { ...ms, rosterLocked: false };
  next = appendLog(next, "Unlocked the roster sheet for drag rearranging.");
  return { ms: next, toast: 'Roster unlocked — drag tiles to rearrange, then "Lock roster" to apply.', suppressConfirmRevoke: false };
}

/** discardDraftChanges() — throws away the draft and re-locks. Discarding always lands back on
 * locked — there's no "stay unlocked with nothing pending" state. Deliberately does NOT
 * early-return when the draft is already empty (that's the fix for the "hit another tab before
 * dragging anything" bug): an unlocked roster with an empty draft must still re-lock, or it's
 * stranded "pending" indefinitely. `ms.overrides` itself is never touched here — the discarded
 * draft never touched it — so an already-confirmed Combined Hours/Invoice figure stays valid
 * (this is the persistDraftChange()-equivalent path: the hook layer should persist this with
 * `suppressConfirmRevoke` semantics, i.e. it must NOT call revokeConfirmationIfPresent()). */
export function applyDiscard(ms: MonthState, session: RosterSession): LockActionOutcome | null {
  if (!canManageRosterLock(session)) return null;
  if (isRosterLocked(ms)) return null;
  const hadDraft = Object.keys(monthDraftOverrides(ms)).length > 0;
  let next: MonthState = { ...ms, draftOverrides: {}, rosterLocked: true };
  next = appendLog(
    next,
    hadDraft ? "Discarded the unlocked rearrangement and locked the roster sheet again." : "Locked the roster sheet (no changes to discard)."
  );
  return { ms: next, toast: hadDraft ? "Discarded — roster sheet is locked again." : "Roster locked.", suppressConfirmRevoke: true };
}

/** Merges any in-progress drag rearrangement (draftOverrides) on top of the live, committed
 * overrides — used ONLY for the Roster sheet's own grid render, so dragging a tile shows its
 * effect immediately without ever touching ms.overrides itself. Every other generateMonth() call
 * (Combined Hours, the plain Summary Report, Guard Bank sync, Adjustments' own pickers, the
 * Roster Calendar view) should keep calling generateMonth() against the real, unmerged month
 * state — entirely unaffected until applyLock() actually merges the draft in for real. */
export function currentMonthStateForRosterDisplay(ms: MonthState): MonthState {
  if (isRosterLocked(ms)) return ms;
  return { ...ms, overrides: { ...ms.overrides, ...monthDraftOverrides(ms) } };
}

export interface SlotRef {
  date: string;
  shiftId: string;
  slot: number;
}

/** performDragSwap() — swaps two Roster-sheet tiles via drag: same two-key override write
 * "Swap two shifts" performs, just scoped to draftOverrides instead of ms.overrides, and
 * computed against currentMonthStateForRosterDisplay() so dragging twice in a row correctly
 * builds on whatever the first drag already showed rather than the original locked-in
 * arrangement. Returns null when not allowed, the roster is locked, or src === dest (no-op). */
export function computeDragSwap(
  y: number,
  m: number,
  config: GenerateMonthConfig,
  ms: MonthState,
  session: RosterSession,
  src: SlotRef,
  dest: SlotRef
): LockActionOutcome | null {
  if (!canManageRosterLock(session)) return null;
  if (isRosterLocked(ms)) return null;
  if (dest.date === src.date && dest.shiftId === src.shiftId && dest.slot === src.slot) return null;

  const site = (config as { site: Parameters<typeof computeShiftDefsForDay>[0] }).site;
  const result = generateMonth(y, m, config, currentMonthStateForRosterDisplay(ms));
  const shiftDefsA = computeShiftDefsForDay(site, dowMon(src.date));
  const shiftDefsB = computeShiftDefsForDay(site, dowMon(dest.date));
  const dayA = result.days.find((d) => d.dateStr === src.date);
  const dayB = result.days.find((d) => d.dateStr === dest.date);
  const stIdxA = shiftDefsA.findIndex((s) => s.id === src.shiftId);
  const stIdxB = shiftDefsB.findIndex((s) => s.id === dest.shiftId);
  const guardA = dayA && stIdxA >= 0 ? dayA.assignments[stIdxA][src.slot] : null;
  const guardB = dayB && stIdxB >= 0 ? dayB.assignments[stIdxB][dest.slot] : null;

  const draft = { ...monthDraftOverrides(ms) };
  draft[src.date + "|" + src.shiftId + "|" + src.slot] = guardB || null;
  draft[dest.date + "|" + dest.shiftId + "|" + dest.slot] = guardA || null;

  const next: MonthState = { ...ms, draftOverrides: draft };
  return { ms: next, toast: 'Swapped — click "Lock roster" to apply.', suppressConfirmRevoke: true };
}

/** warnIfRosterUnlockedThenRun() equivalent, minus the cross-frame concerns (see module doc
 * comment). Callers (any in-page navigation: switching site/client/branch filter, tab clicks)
 * should:
 *   1. If `!canManageRosterLock(session)` or the roster is locked -> just proceed, no warning.
 *   2. Else if `pendingDraftCount(ms) === 0` -> call applyLock() (safe no-op merge), persist it,
 *      then proceed — matches the original's "nothing to lose, just re-lock and go" shortcut.
 *   3. Else -> show the 3-button "Stay / Discard / Lock" modal; its Discard/Lock buttons call
 *      applyDiscard()/applyLock() (persist, then proceed); Stay/dismiss calls the caller's
 *      revert callback and does not navigate.
 * This is left as guidance rather than a function here because "proceed"/"revert"/opening a
 * modal are all UI-layer concerns (Task #18-22 territory), not state-machine logic. */
export function pendingDraftCount(ms: MonthState): number {
  return Object.keys(monthDraftOverrides(ms)).length;
}

export function isNavigationBlockedByRoster(ms: MonthState, session: RosterSession): boolean {
  // Mirrors postLockStatusToParent()'s pending condition, now just a plain boolean instead of a
  // postMessage payload: pending purely from lock state, not from whether anything's been
  // dragged yet — an unlocked roster with an empty draft is still "pending" (the performer could
  // navigate away without ever locking it back).
  return canManageRosterLock(session) && !isRosterLocked(ms);
}
