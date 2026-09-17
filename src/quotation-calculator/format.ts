/**
 * Number formatting — index.html's fmt()/pct() helpers, ported verbatim (same 'en-MY' locale,
 * same "-" fallback for non-finite values) so every displayed figure matches the original
 * calculator exactly.
 */

export function fmt(val: number | null | undefined, dp: number): string {
  return typeof val === 'number' && isFinite(val)
    ? val.toLocaleString('en-MY', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : '-';
}

export function pct(val: number | null | undefined): string {
  return typeof val === 'number' && isFinite(val) ? (val * 100).toFixed(1) + '%' : '-';
}

/** Scenario-table cell text — index.html's cellText(): dp<0 means "format as a percentage". */
export function cellText(val: number | null | undefined, dp: number): string {
  return dp < 0 ? pct(val) : fmt(val, dp);
}

export function pad2(n: number): string {
  const f = Math.floor(n);
  return (f < 10 ? '0' : '') + f;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '-';
  const dd = pad2(d.getDate());
  const mo = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${dd}/${mo}/${yyyy} ${hh}:${mi}`;
}
