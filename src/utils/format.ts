export function formatRM(value: number): string {
  if (!Number.isFinite(value)) return 'RM 0';
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace('MYR', 'RM');
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMonthLabel(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' });
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Auto-inserts dashes as a Malaysian MyKad number is typed (YYMMDD-PB-###G, 12 digits total) —
 * strips anything that isn't a digit first, so pasting an already-dashed number still works.
 * Mirrors formatMykadInput() in public/duty-roster/index.html so both apps agree on the shape.
 */
export function formatMykadInput(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 12);
  let out = digits.slice(0, 6);
  if (digits.length > 6) out += '-' + digits.slice(6, 8);
  if (digits.length > 8) out += '-' + digits.slice(8, 12);
  return out;
}

export function isValidMykad(formatted: string): boolean {
  return /^\d{6}-\d{2}-\d{4}$/.test(formatted || '');
}

/**
 * Auto-inserts a dash as a phone number is typed — after the 3rd digit for a mobile number
 * (01X-XXXXXXX/XXXXXXXX) or the 2nd digit for a landline (0X-XXXXXXXX), matching how Malaysian
 * numbers are actually written (e.g. "012-3456789"). Mirrors formatPhoneInput() in
 * public/duty-roster/index.html.
 */
export function formatPhoneInput(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  const prefixLen = digits.slice(0, 2) === '01' ? 3 : 2;
  if (digits.length <= prefixLen) return digits;
  return digits.slice(0, prefixLen) + '-' + digits.slice(prefixLen);
}

/**
 * Loose on purpose — Malaysian numbers vary between 9 and 11 digits depending on area/mobile
 * prefix — but still requires the auto-formatter's dash to actually be present, so a handful of
 * stray digits can't slip through.
 */
export function isValidPhone(formatted: string): boolean {
  const digits = (formatted || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 11 && digits[0] === '0' && (formatted || '').includes('-');
}
