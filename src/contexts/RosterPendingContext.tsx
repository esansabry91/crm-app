/**
 * Replaces src/services/dutyRosterBridge.ts + src/hooks/useDutyRosterPending.ts (Task #22 —
 * removing the Duty Roster iframe/postMessage bridge now that it's native React composed inside
 * AppLayout, same tree, no cross-frame boundary). AppLayout.tsx's own sidebar-nav/Sign-out guard
 * ("Roster sheet is unlocked" warning) needs to know whether the currently-mounted page has an
 * unlocked roster with pending drag changes, and needs a way to tell it to lock/discard before
 * navigating — exactly what the old module-level singleton + `message` events carried across the
 * iframe boundary, now just ordinary React state lifted to AppLayout and threaded down via
 * context instead.
 *
 * AppLayout renders `<RosterPendingProvider>{children}</RosterPendingProvider>` around whatever
 * page it wraps and reads `pending`/`resolvers` off `useRosterPendingConsumer()` for its own
 * guard logic (unchanged from the original design — see AppLayout.tsx's own doc comments).
 * `DutyRosterPage`'s composed shell calls `useReportRosterPending()` with its own
 * `useRosterLock().navigationBlocked` value and a `{lock, discard}` pair built from
 * `useRosterLock()`'s own `lock`/`discard` — every other page reports nothing (the default
 * `pending: false` from a provider nobody has reported into), so this has zero effect anywhere
 * outside `/duty-roster`.
 *
 * Unlike the old bridge, there's no cross-frame race to wait out: `resolvers.lock()`/`.discard()`
 * call straight into the same React tree's own `useRosterLock()`, so AppLayout doesn't need the
 * old "wait for the next lock-status message, or a 5s timeout" dance — it can fire the resolver
 * and immediately run its own parked navigation action, matching lockMachine.ts's own module doc
 * comment on why that whole problem class disappears in the native-React version.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface RosterPendingResolvers {
  lock: () => void;
  discard: () => void;
}

interface RosterPendingContextValue {
  pending: boolean;
  resolvers: RosterPendingResolvers | null;
  report: (pending: boolean, resolvers: RosterPendingResolvers | null) => void;
}

const RosterPendingContext = createContext<RosterPendingContextValue | null>(null);

export function RosterPendingProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState(false);
  const [resolvers, setResolvers] = useState<RosterPendingResolvers | null>(null);

  const report = useCallback((nextPending: boolean, nextResolvers: RosterPendingResolvers | null) => {
    setPending(nextPending);
    setResolvers(() => nextResolvers);
  }, []);

  const value = useMemo(() => ({ pending, resolvers, report }), [pending, resolvers, report]);

  return <RosterPendingContext.Provider value={value}>{children}</RosterPendingContext.Provider>;
}

/** Consumed by AppLayout itself — the current pending flag, plus the resolvers to call when its
 * own "Stay here / Discard changes / Lock roster" warning is answered. `resolvers` is null
 * whenever `pending` is false (nothing to resolve) or no page has reported at all. */
export function useRosterPendingConsumer(): { pending: boolean; resolvers: RosterPendingResolvers | null } {
  const ctx = useContext(RosterPendingContext);
  if (!ctx) throw new Error("useRosterPendingConsumer must be used within RosterPendingProvider");
  return { pending: ctx.pending, resolvers: ctx.resolvers };
}

/** Consumed by the Duty Roster page shell — reports its own pending/resolvers up to AppLayout
 * whenever they change, and clears them on unmount (leaving `/duty-roster` for any reason, same
 * safety-net intent as the old resetDutyRosterPending()). A no-op when rendered outside the
 * provider (AppLayout always wraps every routed page — see App.tsx — so this should never
 * actually happen; defensive only, never throws, unlike the consumer above). */
export function useReportRosterPending(pending: boolean, resolvers: RosterPendingResolvers | null): void {
  const ctx = useContext(RosterPendingContext);
  useEffect(() => {
    ctx?.report(pending, resolvers);
  }, [ctx, pending, resolvers]);
  useEffect(() => {
    return () => {
      ctx?.report(false, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
}
