/**
 * Shared cell-formatting helpers for the Summary Report / Combined Hours tables — matches the
 * original's own local h()/n()/rm() closures duplicated inside both renderSummaryReport() and
 * renderCombinedReport() (public/duty-roster/index.html lines ~3187-3189, ~3454-3455). Pulled
 * into their own module since both panels (and their Excel exports) use the identical
 * formatters.
 */

/** Placeholder for a column that doesn't apply to this row (e.g. a temp/support guard's
 * per-day breakdown, or a missing rate) — always this exact em-dash, never "0.00" or blank. */
export const DASH = "—";

/** One decimal place, for hour-valued columns (man-hours, OT hours). */
export function fmtHours(v: number | undefined | null): string {
  return (v || 0).toFixed(1);
}

/** Plain integer, no decimal formatting, for day/count columns (normalDays, MC, Absent, …). */
export function fmtCount(v: number | undefined | null): string {
  return String(v || 0);
}

/** Two decimal places, for RM currency columns (Rate, Amount). */
export function fmtRM(v: number | undefined | null): string {
  return (v || 0).toFixed(2);
}
