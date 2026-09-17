/**
 * Date/time helpers — ported verbatim (logic-for-logic) from public/duty-roster/index.html
 * lines ~765-793. UTC-based throughout, exactly like the original, so a roster date never
 * shifts by a day under a viewer's local timezone.
 */
import type { ShiftDef } from "./types";

export function ymd(y: number, m: number, d: number): string {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseYM(key: string): { y: number; m: number } {
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}

export function todayYM(): { y: number; m: number } {
  const n = new Date();
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1 };
}

export function monthKey(y: number, m: number): string {
  return y + "-" + String(m).padStart(2, "0");
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return { y: ny, m: nm };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(y: number, m: number): string {
  return MONTH_NAMES[m - 1] + " " + y;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function weekdayShort(y: number, m: number, d: number): string {
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function isWeekend(y: number, m: number, d: number): boolean {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

export function prevDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function nextDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function shiftStartEnd(dateStr: string, shiftType: Pick<ShiftDef, "startHour" | "hours">): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, shiftType.startHour, 0, 0));
  const end = new Date(start.getTime() + shiftType.hours * 3600000);
  return { start, end };
}

/** Monday=0..Sunday=6 (the original's `dm`, used throughout for weekday/weekend + coverage-day
 * math — deliberately NOT JS's native Sunday=0 day-of-week). */
export function dowMon(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (jsDay + 6) % 7;
}
