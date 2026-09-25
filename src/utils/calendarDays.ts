/**
 * Whole calendar days from `now`'s local date until an ISO `yyyy-mm-dd` date.
 * `0` means that date is today. Negative once that calendar day has passed.
 *
 * Both instants are local noon. Comparing the end date at noon against local
 * midnight and then rounding (the previous Active Projects helper) turns
 * "ended yesterday" into -0.5 days, and `Math.round(-0.5)` is -0, which is not
 * `< 0`. The contract then stays in "ending soon" for an extra day and "ending
 * today" reads as 1 day left. Noon-to-noon stays on a calendar-day boundary
 * even when a daylight-saving transition sits between the two dates.
 */
export function calendarDaysUntil(iso: string | undefined | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const end = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    Number.isNaN(end.getTime()) ||
    end.getFullYear() !== year ||
    end.getMonth() !== month - 1 ||
    end.getDate() !== day
  ) {
    return null;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}
