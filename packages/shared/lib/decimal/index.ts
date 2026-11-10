/**
 * Locale-aware parsing of typed or exported decimal numbers (amounts, prices, quantities).
 *
 * Amounts are money: reading "1.234,56" with the wrong separator changes a value by a factor of
 * 1,000. The rules, in order:
 *
 * - When both "." and "," appear, the last one is the decimal separator ("1.234,56" and
 *   "1,234.56" are 1234.56 in every locale). Spaces (including no-break spaces) and apostrophes
 *   are only ever thousands separators ("1 234,56", "1'234.56").
 * - A separator that repeats is a thousands separator ("1.234.567").
 * - A single "." or "," that cannot be a thousands separator (it is not followed by exactly
 *   three digits after one to three leading digits) is the decimal separator ("0,5", "12.50",
 *   "1234,567").
 * - Only "1,234" / "1.234" (one separator followed by exactly three digits) is ambiguous. The
 *   locale's decimal separator, or an explicit one, settles it: "1.000" is 1000 in pt and es and
 *   1 in en. Without either, it is rejected.
 * - Thousands groups must be well formed (1-3 digits, then groups of exactly 3); anything else
 *   ("1.23.456", "1,234,56", "12,", "1e5") is rejected rather than guessed.
 *
 * A leading sign ("-", "+", U+2212), accounting parentheses, and a currency symbol or ISO code
 * on either side are accepted. The result is a canonical decimal string ("-1234.56"), never a
 * float, so no digit is lost; `null` means the input is not a number.
 *
 * This module has no dependencies so web and mobile can import it directly
 * (`@wondermoney/shared/decimal`).
 */

export type DecimalSeparator = '.' | ',';

export interface ParseDecimalOptions {
  /** BCP 47 locale whose decimal separator settles "1.234" / "1,234" (e.g. "pt-PT"). */
  locale?: string;
  /** Explicit decimal separator; wins over `locale`. Use it for files with a known format. */
  decimalSeparator?: DecimalSeparator;
}

const CURRENCY_SYMBOLS = '$€£¥¢₹₽₩₪₫₺₴₦฿₱₲₵₡₸₼₾₿';
// "€", "R$", "US$", "EUR", "CHF".
const CURRENCY = `(?:[A-Z]{0,3}[${CURRENCY_SYMBOLS}]|[A-Z]{3})`;
const SIGN = '[-+\u2212]';
const NUMBER_SHAPE = new RegExp(
  `^(\\()?\\s*(${SIGN})?\\s*(${CURRENCY})?\\s*(${SIGN})?\\s*([0-9.,'\u2019 ]+?)\\s*(${CURRENCY})?\\s*(\\))?$`
);
const SPACES = /[\u00a0\u2007\u2009\u202f]/g;
const GROUP_ONLY = [' ', "'", '\u2019'] as const;

const separatorCache = new Map<string, DecimalSeparator>();

/** The decimal separator a locale writes, from `Intl.NumberFormat`; "." if it is unknown. */
export function decimalSeparatorForLocale(locale: string): DecimalSeparator {
  const cached = separatorCache.get(locale);
  if (cached) return cached;
  let separator: DecimalSeparator = '.';
  try {
    if (locale.trim()) {
      separator = new Intl.NumberFormat(locale).format(1.5).includes(',') ? ',' : '.';
    }
  } catch {
    separator = '.';
  }
  separatorCache.set(locale, separator);
  return separator;
}

type Split = {
  negative: boolean;
  integer: string;
  fraction: string | null;
  decimal: DecimalSeparator | null;
  group: string | null;
};

const count = (text: string, char: string) => text.split(char).length - 1;

/** Splits `input` into its parts; 'ambiguous' when only a locale could tell, null if invalid. */
function split(
  input: string,
  decimalSeparator: DecimalSeparator | undefined
): Split | 'ambiguous' | null {
  const match = NUMBER_SHAPE.exec(input.replace(SPACES, ' ').trim());
  if (!match) return null;
  const [, open, sign1, prefix, sign2, rawBody, suffix, close] = match;
  if (Boolean(open) !== Boolean(close)) return null;
  if (sign1 && sign2) return null;
  if (prefix && suffix) return null;
  const sign = sign1 ?? sign2;
  if (open && sign) return null;
  const body = rawBody!;
  if (!/\d/.test(body)) return null;
  if (!/\d$/.test(body)) return null;

  const groupOnly = GROUP_ONLY.filter((char) => body.includes(char));
  if (groupOnly.length > 1) return null;
  const spacer = groupOnly[0] ?? null;
  const dots = count(body, '.');
  const commas = count(body, ',');

  let decimal: DecimalSeparator | null = null;
  let group: string | null = spacer;
  if (dots > 0 && commas > 0) {
    if (spacer) return null;
    decimal = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    if (count(body, decimal) > 1) return null;
    group = decimal === '.' ? ',' : '.';
  } else if (dots + commas > 1) {
    if (spacer) return null;
    group = dots > 0 ? '.' : ',';
  } else if (dots + commas === 1) {
    const char: DecimalSeparator = dots > 0 ? '.' : ',';
    const groupShaped = new RegExp(`^[1-9]\\d{0,2}\\${char}\\d{3}$`).test(body);
    if (spacer || !groupShaped) {
      decimal = char;
    } else if (!decimalSeparator) {
      return 'ambiguous';
    } else if (char === decimalSeparator) {
      decimal = char;
    } else {
      group = char;
    }
  }

  const point = decimal ? body.indexOf(decimal) : -1;
  const integerText = point >= 0 ? body.slice(0, point) : body;
  const fraction = point >= 0 ? body.slice(point + 1) : null;
  if (fraction !== null && !/^\d+$/.test(fraction)) return null;

  let integer: string;
  if (group) {
    const groups = integerText.split(group);
    const [first, ...rest] = groups;
    if (!/^[1-9]\d{0,2}$/.test(first!)) return null;
    if (rest.length === 0 || rest.some((part) => !/^\d{3}$/.test(part))) return null;
    integer = groups.join('');
  } else {
    if (!/^\d*$/.test(integerText)) return null;
    integer = integerText;
  }

  return {
    negative: Boolean(open) || sign === '-' || sign === '\u2212',
    integer,
    fraction,
    decimal,
    group,
  };
}

function resolveSeparator(options: ParseDecimalOptions): DecimalSeparator | undefined {
  if (options.decimalSeparator) return options.decimalSeparator;
  if (options.locale !== undefined) return decimalSeparatorForLocale(options.locale);
  return undefined;
}

/**
 * Parses a typed or exported number into a canonical decimal string ("-1234.56"), or `null` if
 * it is not a number or is ambiguous. See the module comment for the rules.
 */
export function parseDecimal(
  value: string | null | undefined,
  options: ParseDecimalOptions = {}
): string | null {
  if (typeof value !== 'string') return null;
  const parts = split(value, resolveSeparator(options));
  if (!parts || parts === 'ambiguous') return null;
  const integer = parts.integer.replace(/^0+(?=\d)/, '') || '0';
  const text = parts.fraction !== null ? `${integer}.${parts.fraction}` : integer;
  const zero = !/[1-9]/.test(text);
  return parts.negative && !zero ? `-${text}` : text;
}

/** `parseDecimal` as a JavaScript number, for callers that work in numbers. */
export function parseDecimalNumber(
  value: string | null | undefined,
  options: ParseDecimalOptions = {}
): number | null {
  const parsed = parseDecimal(value, options);
  if (parsed === null) return null;
  const number = Number(parsed);
  return Number.isFinite(number) ? number : null;
}

/**
 * The decimal separator a set of values (for example one column of an export) consistently
 * uses, judged only from the values that are unambiguous on their own. `null` if none says, or
 * if they disagree.
 */
export function detectDecimalSeparator(values: Iterable<string>): DecimalSeparator | null {
  let found: DecimalSeparator | null = null;
  for (const value of values) {
    const parts = split(value, undefined);
    if (!parts || parts === 'ambiguous') continue;
    const said: DecimalSeparator | null =
      parts.decimal ?? (parts.group === '.' ? ',' : parts.group === ',' ? '.' : null);
    if (!said) continue;
    if (found && found !== said) return null;
    found = said;
  }
  return found;
}
