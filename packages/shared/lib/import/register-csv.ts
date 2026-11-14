/**
 * Reading the register CSV a budgeting app exports (YNAB, Actual Budget): its text, its delimiter
 * and its amounts. The app writes UTF-8 with commas, but a file re-saved by a spreadsheet may use
 * another delimiter and the person's own number format, so both are read from the file itself.
 *
 * ## Amounts
 *
 * A cell may carry a currency symbol (`$1,234.56`, `1.234,56 €`, `CHF 1'234.50`, `¥1,234`). The
 * symbol, spaces and apostrophes are stripped, and the decimal separator is read from every amount
 * in the file: a cell with both `.` and `,` has the later one as its decimal, a separator that
 * repeats is a thousands separator, and one followed by other than three digits is a decimal. A
 * separator before exactly three digits is a thousands separator unless the rest of the file says
 * it is the decimal. A minus sign or brackets make a cell negative.
 */

/** UTF-8 (without its byte-order mark); a file that is not valid UTF-8 (an older YNAB 4 on Windows) is read as Windows-1252. */
export function decodeRegister(input: Uint8Array): string {
  const bytes = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The header's delimiter: the apps write commas; a file re-saved by a spreadsheet may use `;` or a tab. */
export function delimiterOf(headerLine: string): string {
  const counts = [',', ';', '\t'].map((candidate) => [candidate, headerLine.split(candidate).length - 1] as const);
  return counts.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

/** The cells of a header line, unquoted and trimmed: enough to recognise an export by its columns. */
export function headerCellsOf(input: Uint8Array): string[] {
  const head = decodeRegister(input.subarray(0, 4096));
  const line = head.split(/\r\n|\r|\n/, 1)[0] ?? '';
  return line.split(delimiterOf(line)).map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

export type DecimalSeparator = ',' | '.';

/** The digits and separators of a cell, with the symbol, spaces and apostrophes gone. */
function numberPart(value: string): string {
  return value.replace(/[^\d.,]/g, '');
}

/**
 * The decimal separator the file's amounts use. Each cell votes when it can tell (both separators,
 * a repeated one, one not followed by exactly three digits); with no vote either way, a
 * separator before three digits is read as a thousands separator, so the decimal is `.`.
 */
export function decimalSeparatorOf(cells: readonly string[]): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const cell of cells) {
    const vote = voteOf(numberPart(cell));
    if (vote === ',') comma += 1;
    else if (vote === '.') dot += 1;
  }
  return comma > dot ? ',' : '.';
}

function voteOf(text: string): DecimalSeparator | undefined {
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) return lastComma > lastDot ? ',' : '.';
  const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : undefined;
  if (!separator) return undefined;
  const other: DecimalSeparator = separator === ',' ? '.' : ',';
  if (text.split(separator).length > 2) return other;
  return text.length - text.indexOf(separator) - 1 === 3 ? undefined : separator;
}

/** A cell as a number in the file's format; an empty cell is zero, one with no digits is unreadable. */
export function parseRegisterAmount(value: string, decimal: DecimalSeparator): number | undefined {
  const text = value.trim();
  if (text === '') return 0;
  const negative = /^\(.*\)$/.test(text) || /[-−]/.test(text);
  let digits = numberPart(text);
  if (!/\d/.test(digits)) return undefined;
  const thousands = decimal === ',' ? '.' : ',';
  digits = digits.split(thousands).join('');
  // A decimal separator that repeats is a thousands separator after all.
  if (digits.split(decimal).length > 2) digits = digits.split(decimal).join('');
  const amount = Number(digits.replace(decimal, '.'));
  if (!Number.isFinite(amount)) return undefined;
  return negative ? -amount : amount;
}

export function roundCents(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
