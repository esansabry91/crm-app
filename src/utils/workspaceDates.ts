/**
 * Date helpers for My Workspace (Today Tasks / Weekly Planner / Meeting Schedule) — mirrors
 * gdsb-portal's apps/web/src/lib/dates.ts plus the inline date utilities its Planner.tsx kept to
 * itself, adapted for crm-app. All "today" calculations use Asia/Kuala_Lumpur, same as the
 * reference project, since both are run by/for staff in Malaysia regardless of the device's own
 * time zone.
 */

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today as `YYYY-MM-DD` in Kuala Lumpur, whatever the device's own time zone is. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `YYYY-MM-DD` + n days (n may be negative) -> `YYYY-MM-DD`. Pure calendar math, no time zone
 *  involved once we already have an ISO date string to start from. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function tomorrowIso(): string {
  return addDays(todayIso(), 1);
}

/** 0 = Monday … 6 = Sunday, matching Celebration.tsx's own `weekday` convention. */
export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return (jsDay + 6) % 7;
}

/** The Monday on/before the given date. */
export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** The 7 `YYYY-MM-DD` dates of the Monday-starting week containing `start` (or for `start`
 *  itself, if it's already a Monday). */
export function weekDates(start: string): string[] {
  const monday = mondayOf(start);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** `Mon 13 Oct` — short weekday + day + month, for planner column headers and meeting lists. */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_LABELS[weekdayIndex(iso)]} ${d} ${MONTH_LABELS[m - 1]}`;
}

/** `13/10/2026` — for compact display. */
export function formatDateDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/** `Mon 13 Oct – Sun 19 Oct` for a week's header. */
export function weekRangeLabel(start: string): string {
  const dates = weekDates(start);
  return `${dayLabel(dates[0])} – ${dayLabel(dates[6])}`;
}

/** Hour of the day in Malaysia (0–23), whatever the device's own time zone is — shared by the
 *  daily priority prompt's greeting. */
export function hourInMalaysia(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(now);
  return Number(hour);
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 19) return 'Good afternoon';
  return 'Good evening';
}
