/** Converts a Ringgit-and-cents amount into the "RINGGIT MALAYSIA ... ONLY" wording used on the
 *  sample invoices this feature was modeled on (e.g. 55244.59 -> "RINGGIT MALAYSIA FIFTY FIVE
 *  THOUSAND TWO HUNDRED FORTY FOUR AND FIFTY NINE CENT ONLY"). Handles amounts up to just under
 *  1 trillion, which is more than any realistic invoice here needs. */

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], 'HUNDRED');
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]);
    n %= 10;
    if (n > 0) parts.push(ONES[n]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'ZERO';
  const scales: [number, string][] = [
    [1_000_000_000, 'BILLION'],
    [1_000_000, 'MILLION'],
    [1_000, 'THOUSAND'],
    [1, ''],
  ];
  const parts: string[] = [];
  for (const [scale, label] of scales) {
    if (n >= scale) {
      const chunk = Math.floor(n / scale);
      n %= scale;
      parts.push(label ? `${threeDigitsToWords(chunk)} ${label}` : threeDigitsToWords(chunk));
    }
  }
  return parts.filter(Boolean).join(' ');
}

/** e.g. amountToRinggitWords(55244.59) -> "RINGGIT MALAYSIA FIFTY FIVE THOUSAND TWO HUNDRED
 *  FORTY FOUR AND FIFTY NINE CENT ONLY" */
export function amountToRinggitWords(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const ringgit = Math.floor(rounded);
  const cents = Math.round((rounded - ringgit) * 100);
  const ringgitWords = integerToWords(ringgit);
  if (cents === 0) {
    return `RINGGIT MALAYSIA ${ringgitWords} ONLY`;
  }
  const centWords = integerToWords(cents);
  return `RINGGIT MALAYSIA ${ringgitWords} AND ${centWords} CENT ONLY`;
}

/** Lowercase cardinal word for a small non-negative integer, for use in ordinary sentence-case
 *  text like "thirty (30) days" in Terms and Conditions clauses. */
export function cardinalWordsLower(n: number): string {
  return integerToWords(Math.max(0, Math.round(n))).toLowerCase();
}
