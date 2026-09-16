import { useEffect, useState } from 'react';
import { subscribeDutyRosterPending } from '../services/dutyRosterBridge';

/**
 * Whether the embedded Duty Roster page currently has an unlocked roster with pending drag
 * changes — see dutyRosterBridge.ts for how this crosses the iframe boundary. AppLayout.tsx
 * uses this to gate sidebar navigation and Sign out the same way the Duty Roster console
 * itself already gates its own internal tabs/filters.
 */
export function useDutyRosterPending(): boolean {
  const [pending, setPending] = useState(false);
  useEffect(() => subscribeDutyRosterPending(setPending), []);
  return pending;
}
