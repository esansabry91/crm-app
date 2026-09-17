/**
 * Small pure string-formatting/validation helpers shared by the "Add guard" modal (Guards &
 * Shifts) and every place the Adjustments tab collects a temporary guard's identity (the
 * "Assign a temporary guard" panel and the temp-guard branch of "Assign an additional guard").
 * Ported verbatim from public/duty-roster/index.html lines ~1682-1711.
 */

/** Formats raw MyKad input into "DDDDDD-DD-DDDD" as the user types (dashes auto-inserted, max 12
 * digits kept, everything else stripped). */
export function formatMykadInput(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "").slice(0, 12);
  let out = digits.slice(0, 6);
  if (digits.length > 6) out += "-" + digits.slice(6, 8);
  if (digits.length > 8) out += "-" + digits.slice(8, 12);
  return out;
}

/** A MyKad is valid only once it's the full "DDDDDD-DD-DDDD" shape (already dash-formatted). */
export function isValidMykad(formatted: string): boolean {
  return /^\d{6}-\d{2}-\d{4}$/.test(formatted || "");
}

/** Formats raw phone input as a Malaysian mobile ("01X-XXXXXXX(X)", dash after the 3rd digit) or
 * landline ("0X-XXXXXXXX", dash after the 2nd digit), auto-detected by whether the number starts
 * "01". */
export function formatPhoneInput(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  const prefixLen = digits.slice(0, 2) === "01" ? 3 : 2;
  if (digits.length <= prefixLen) return digits;
  return digits.slice(0, prefixLen) + "-" + digits.slice(prefixLen);
}

/** Loose by design (Malaysian numbers vary 9-11 digits depending on area/mobile prefix): must
 * start with "0", contain a dash (i.e. already formatted), and have 9-11 digits total. */
export function isValidPhone(formatted: string): boolean {
  const digits = (formatted || "").replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 11 && digits[0] === "0" && (formatted || "").includes("-");
}
