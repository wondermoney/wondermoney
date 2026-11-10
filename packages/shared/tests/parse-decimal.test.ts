import { describe, expect, it } from 'vitest';

import {
  decimalSeparatorForLocale,
  detectDecimalSeparator,
  parseDecimal,
  parseDecimalNumber,
} from '../lib/decimal';

/*
 * Amounts are money: a misread separator changes a value by a factor of 1,000. Every row says
 * what each locale must make of the same text; `null` means the input is rejected, never guessed.
 */
type Row = [input: string, en: string | null, pt: string | null, es: string | null];

const table: Row[] = [
  // Both separators present: the last one is the decimal separator, whatever the locale.
  ['1.234,56', '1234.56', '1234.56', '1234.56'],
  ['1,234.56', '1234.56', '1234.56', '1234.56'],
  ['1.234.567,89', '1234567.89', '1234567.89', '1234567.89'],
  ['1,234,567.89', '1234567.89', '1234567.89', '1234567.89'],
  // Space and apostrophe thousands separators (fr, pt-PT, de-CH; Intl output uses NBSP/NNBSP).
  ['1 234,56', '1234.56', '1234.56', '1234.56'],
  ['1 234.56', '1234.56', '1234.56', '1234.56'],
  ['1\u00a0234,56', '1234.56', '1234.56', '1234.56'],
  ['1\u202f234,56', '1234.56', '1234.56', '1234.56'],
  ["1'234.56", '1234.56', '1234.56', '1234.56'],
  ['1\u2019234,56', '1234.56', '1234.56', '1234.56'],
  ['1 234 567', '1234567', '1234567', '1234567'],
  // Ambiguous: one separator followed by exactly three digits. The locale decides.
  ['1,234', '1234', '1.234', '1.234'],
  ['1.234', '1.234', '1234', '1234'],
  ['1.000', '1.000', '1000', '1000'],
  ['1,000', '1000', '1.000', '1.000'],
  ['-1.000', '-1.000', '-1000', '-1000'],
  ['999,999', '999999', '999.999', '999.999'],
  // One separator that cannot be a thousands separator is the decimal separator in any locale.
  ['0,5', '0.5', '0.5', '0.5'],
  ['0.5', '0.5', '0.5', '0.5'],
  ['12,50', '12.50', '12.50', '12.50'],
  ['12.50', '12.50', '12.50', '12.50'],
  ['1234,567', '1234.567', '1234.567', '1234.567'],
  ['1234.567', '1234.567', '1234.567', '1234.567'],
  ['1,2345', '1.2345', '1.2345', '1.2345'],
  ['0,123', '0.123', '0.123', '0.123'],
  ['0.123', '0.123', '0.123', '0.123'],
  [',5', '0.5', '0.5', '0.5'],
  ['.5', '0.5', '0.5', '0.5'],
  // A repeated separator is a thousands separator.
  ['1.234.567', '1234567', '1234567', '1234567'],
  ['1,234,567', '1234567', '1234567', '1234567'],
  // Plain digits.
  ['42', '42', '42', '42'],
  ['007', '7', '7', '7'],
  ['0', '0', '0', '0'],
  ['  12,5  ', '12.5', '12.5', '12.5'],
  // Negatives.
  ['-12,30', '-12.30', '-12.30', '-12.30'],
  ['-12.30', '-12.30', '-12.30', '-12.30'],
  ['\u221212,30', '-12.30', '-12.30', '-12.30'],
  ['+12,30', '12.30', '12.30', '12.30'],
  ['- 12,30', '-12.30', '-12.30', '-12.30'],
  ['-0,00', '0.00', '0.00', '0.00'],
  // Parentheses (accounting negatives).
  ['(12,30)', '-12.30', '-12.30', '-12.30'],
  ['(1.234,56)', '-1234.56', '-1234.56', '-1234.56'],
  ['(1,234.56)', '-1234.56', '-1234.56', '-1234.56'],
  // Currency symbols and codes, either side, with or without a space.
  ['€1.234,56', '1234.56', '1234.56', '1234.56'],
  ['1.234,56 €', '1234.56', '1234.56', '1234.56'],
  ['1.234,56\u00a0€', '1234.56', '1234.56', '1234.56'],
  ['$1,234.56', '1234.56', '1234.56', '1234.56'],
  ['-$12.30', '-12.30', '-12.30', '-12.30'],
  ['$-12.30', '-12.30', '-12.30', '-12.30'],
  ['-12,30 €', '-12.30', '-12.30', '-12.30'],
  ['(€12,30)', '-12.30', '-12.30', '-12.30'],
  ['R$ 1.234,56', '1234.56', '1234.56', '1234.56'],
  ['US$1,234.56', '1234.56', '1234.56', '1234.56'],
  ['EUR 1.234,56', '1234.56', '1234.56', '1234.56'],
  ['1 234,56 EUR', '1234.56', '1234.56', '1234.56'],
  ['£0.99', '0.99', '0.99', '0.99'],
  ["CHF 1'234.50", '1234.50', '1234.50', '1234.50'],
  ['€1.000', '1.000', '1000', '1000'],
  // Rejected instead of guessed.
  ['', null, null, null],
  ['   ', null, null, null],
  ['-', null, null, null],
  ['€', null, null, null],
  ['abc', null, null, null],
  ['12abc', null, null, null],
  ['1.2.3', null, null, null],
  ['1,2,3', null, null, null],
  ['1.23.456', null, null, null],
  ['1,234,56', null, null, null],
  ['12.345,67.89', null, null, null],
  ['1,234.567,89', null, null, null],
  ['1 234.567,89', null, null, null],
  ['1.234 567', null, null, null],
  ['12 34', null, null, null],
  ['1234 567', null, null, null],
  ['0 123', null, null, null],
  ['1,2345,678', null, null, null],
  ['12,', null, null, null],
  ['12.', null, null, null],
  ['.', null, null, null],
  ['--12', null, null, null],
  ['-(12)', null, null, null],
  ['(-12)', null, null, null],
  ['(12', null, null, null],
  ['12)', null, null, null],
  ['1e5', null, null, null],
  ['Infinity', null, null, null],
  ['NaN', null, null, null],
  ['0x10', null, null, null],
  ['12 - 3', null, null, null],
  ['€€12', null, null, null],
  ['€12 €', null, null, null],
  ['12,30-', null, null, null],
];

describe('parseDecimal', () => {
  describe.each([
    ['en', 1],
    ['pt-PT', 2],
    ['es', 3],
  ] as const)('locale %s', (locale, column) => {
    it.each(table.map((row) => ({ input: row[0], expected: row[column] })))(
      '$input -> $expected',
      ({ input, expected }) => {
        expect(parseDecimal(input, { locale })).toBe(expected);
      }
    );
  });

  it('follows regional variants of a language', () => {
    expect(parseDecimal('1.000', { locale: 'pt-BR' })).toBe('1000');
    expect(parseDecimal('1.000', { locale: 'pt' })).toBe('1000');
    expect(parseDecimal('1.000', { locale: 'es-ES' })).toBe('1000');
    expect(parseDecimal('1.000', { locale: 'es-MX' })).toBe('1.000');
    expect(parseDecimal('1.000', { locale: 'en-GB' })).toBe('1.000');
    expect(parseDecimal('1,000', { locale: 'de-CH' })).toBe('1000');
    expect(parseDecimal('1,000', { locale: 'fr-FR' })).toBe('1.000');
  });

  it('takes an explicit separator over the locale', () => {
    expect(parseDecimal('1.000', { locale: 'pt-PT', decimalSeparator: '.' })).toBe('1.000');
    expect(parseDecimal('1,000', { locale: 'en', decimalSeparator: ',' })).toBe('1.000');
    expect(parseDecimal('1,000', { decimalSeparator: ',' })).toBe('1.000');
    expect(parseDecimal('1.000', { decimalSeparator: ',' })).toBe('1000');
  });

  it('rejects the ambiguous case when it has neither a locale nor a separator', () => {
    expect(parseDecimal('1.234')).toBeNull();
    expect(parseDecimal('1,234')).toBeNull();
    expect(parseDecimal('-1,000')).toBeNull();
    expect(parseDecimal('1.234,56')).toBe('1234.56');
    expect(parseDecimal('1,234.56')).toBe('1234.56');
    expect(parseDecimal('12,5')).toBe('12.5');
    expect(parseDecimal('1.234.567')).toBe('1234567');
    expect(parseDecimal('1 234')).toBe('1234');
    expect(parseDecimal('42')).toBe('42');
  });

  it('keeps every digit instead of rounding through a float', () => {
    expect(parseDecimal('12345678901234567890,123456789', { locale: 'pt-PT' })).toBe(
      '12345678901234567890.123456789'
    );
    expect(parseDecimal('0,1', { locale: 'pt-PT' })).toBe('0.1');
  });

  it('falls back to a dot for an unknown or invalid locale', () => {
    expect(parseDecimal('1.000', { locale: 'not a locale!' })).toBe('1.000');
    expect(parseDecimal('1.000', { locale: '' })).toBe('1.000');
  });

  it('rejects values that are not strings', () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });
});

describe('parseDecimalNumber', () => {
  it('returns the parsed number or null', () => {
    expect(parseDecimalNumber('1.234,56', { locale: 'pt-PT' })).toBe(1234.56);
    expect(parseDecimalNumber('1.000', { locale: 'es' })).toBe(1000);
    expect(parseDecimalNumber('1.000', { locale: 'en' })).toBe(1);
    expect(parseDecimalNumber('(12,30)', { locale: 'es' })).toBe(-12.3);
    expect(parseDecimalNumber('abc', { locale: 'en' })).toBeNull();
  });
});

describe('decimalSeparatorForLocale', () => {
  it.each([
    ['en', '.'],
    ['en-US', '.'],
    ['pt-PT', ','],
    ['pt-BR', ','],
    ['es', ','],
    ['es-MX', '.'],
    ['de-CH', '.'],
    ['', '.'],
    ['@@', '.'],
  ] as const)('%s -> %s', (locale, separator) => {
    expect(decimalSeparatorForLocale(locale)).toBe(separator);
  });
});

describe('detectDecimalSeparator', () => {
  it('reads the separator from the values that are unambiguous on their own', () => {
    expect(detectDecimalSeparator(['-200,00', '1', '100,5'])).toBe(',');
    expect(detectDecimalSeparator(['-200.00', '1', '100.5'])).toBe('.');
    expect(detectDecimalSeparator(['1.234', '1.234,56'])).toBe(',');
    expect(detectDecimalSeparator(['1,234', '1,234.56'])).toBe('.');
    expect(detectDecimalSeparator(['1.234.567'])).toBe(',');
  });

  it('returns null when the values never say, or contradict each other', () => {
    expect(detectDecimalSeparator(['1', '2', ''])).toBeNull();
    expect(detectDecimalSeparator(['1,234', '1.234'])).toBeNull();
    expect(detectDecimalSeparator(['12,50', '12.50'])).toBeNull();
  });
});
