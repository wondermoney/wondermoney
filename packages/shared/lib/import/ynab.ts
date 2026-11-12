import { parse } from 'csv-parse/sync';

import { type DateOrder, parseOrderedDate, resolveDateOrder } from './date-order';
import type { ImportAdapter, ImportParseResult, ImportSourceAccount, ImportSourceCategory, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * YNAB register export reader, for the staged import session.
 *
 * Two exports are read, told apart by their columns:
 * - the YNAB web export ("Export budget data" gives a zip; its `Register.csv`): `Account, Flag,
 *   Date, Payee, Category Group/Category, Category Group, Category, Memo, Outflow, Inflow, Cleared`;
 * - the YNAB 4 export: `Account, Flag, Check Number, Date, Payee, Category, Master Category,
 *   Sub Category, Memo, Outflow, Inflow, Cleared, Running Balance`.
 *
 * One file holds every account of the budget, so each row names its source account (`Account`)
 * and every account is listed for the mapping step, even when there is only one.
 *
 * ## Amounts
 *
 * The amount is `Inflow - Outflow`. Both are written in the budget's own number format, with its
 * currency symbol (`$1,234.56`, `1.234,56 €`, `CHF 1'234.50`, `¥1,234`). The symbol, spaces and
 * apostrophes are stripped, and the decimal separator is read from every amount in the file: a
 * cell with both `.` and `,` has the later one as its decimal, a separator that repeats is a
 * thousands separator, and one followed by other than three digits is a decimal. A separator
 * before exactly three digits is a thousands separator unless the rest of the file says it is the
 * decimal. A minus sign or brackets make a cell negative.
 *
 * ## Dates
 *
 * The date is written in the budget's date format, so the order is read from every date in the
 * file (`date-order.ts`, as for QIF): ambiguous throughout, the reader asks.
 *
 * ## Transfers and categories
 *
 * A `Transfer : <Account>` payee is one side of a transfer between two of the budget's accounts:
 * the row is typed as the transfer the file states, with the other account named, and when both
 * sides are imported transfer matching links them. A row in YNAB's `Inflow` group ("Ready to
 * Assign", formerly "To be Budgeted"; YNAB 4's `Income: Available this month`) is income with no
 * category. Every other category is listed, with its group, for the category-mapping step.
 *
 * YNAB states no transaction id, so every row is a fingerprint of its date and amount within its
 * account: the same export read again finds its rows as duplicates.
 */

export interface YnabAdapterOptions {
  /** How an ambiguous date reads. Absent, the file's own dates decide, and the reader asks. */
  dateOrder?: DateOrder;
}

/** The file is not a YNAB register export at all (its columns are missing, or it is not CSV). */
export class YnabUnreadableError extends Error {
  constructor(readonly code: 'columns_not_found' | 'unreadable' = 'unreadable') {
    super(code === 'columns_not_found' ? 'This file is not a YNAB register export' : 'Could not read the YNAB export');
    this.name = 'YnabUnreadableError';
  }
}

type YnabVariant = 'web' | 'ynab4';

interface Columns {
  account: number;
  category?: number;
  categoryGroup?: number;
  categoryName?: number;
  cleared?: number;
  date: number;
  flag?: number;
  inflow: number;
  memo?: number;
  outflow: number;
  payee: number;
  variant: YnabVariant;
}

/** The columns of a YNAB register header, or `undefined` when the header is not one. */
function columnsOf(header: readonly string[]): Columns | undefined {
  const index = new Map(header.map((name, position) => [name.replace(/^\uFEFF/, '').trim().toLowerCase(), position] as const));
  const at = (name: string) => index.get(name);
  const account = at('account');
  const date = at('date');
  const payee = at('payee');
  const outflow = at('outflow');
  const inflow = at('inflow');
  if (account === undefined || date === undefined || payee === undefined || outflow === undefined || inflow === undefined) return undefined;
  const common = { account, cleared: at('cleared'), date, flag: at('flag'), inflow, memo: at('memo'), outflow, payee };
  if (at('master category') !== undefined && at('sub category') !== undefined) {
    return { ...common, category: at('category'), categoryGroup: at('master category'), categoryName: at('sub category'), variant: 'ynab4' };
  }
  if (at('category group/category') !== undefined || (at('category group') !== undefined && at('category') !== undefined)) {
    return { ...common, category: at('category group/category'), categoryGroup: at('category group'), categoryName: at('category'), variant: 'web' };
  }
  return undefined;
}

/** Whether the bytes look like a YNAB register export: a header with YNAB's columns. */
export function isYnabFile(input: Uint8Array): boolean {
  const head = decode(input.subarray(0, 4096));
  const line = head.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const delimiter = delimiterOf(line);
  return columnsOf(line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''))) !== undefined;
}

export const ynabImportAdapter: ImportAdapter<YnabAdapterOptions> = {
  format: 'ynab',
  async parse(input, options) {
    const text = decode(input);
    let records: { info: { lines: number }; record: string[] }[];
    try {
      records = parse(text, { delimiter: delimiterOf(text.split(/\r\n|\r|\n/, 1)[0] ?? ''), info: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as unknown as typeof records;
    } catch {
      throw new YnabUnreadableError('unreadable');
    }
    const [header, ...lines] = records;
    const columns = header ? columnsOf(header.record) : undefined;
    if (!columns) throw new YnabUnreadableError('columns_not_found');
    return buildResult(lines, columns, options);
  },
};

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/** YNAB writes UTF-8; a file that is not valid UTF-8 (an older YNAB 4 on Windows) is read as Windows-1252. */
function decode(input: Uint8Array): string {
  const bytes = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The header's delimiter: YNAB writes commas; a file re-saved by a spreadsheet may use `;` or a tab. */
function delimiterOf(headerLine: string): string {
  const counts = [',', ';', '\t'].map((candidate) => [candidate, headerLine.split(candidate).length - 1] as const);
  return counts.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface YnabLine {
  account?: string;
  categoryGroup?: string;
  categoryLabel?: string;
  categoryName?: string;
  cleared?: string;
  date: string;
  flag?: string;
  inflow: string;
  line: number;
  memo?: string;
  outflow: string;
  payee?: string;
}

function lineOf(record: string[], line: number, columns: Columns): YnabLine {
  const cell = (position: number | undefined) => (position === undefined ? undefined : clean(record[position], 1000));
  return {
    account: cell(columns.account),
    categoryGroup: cell(columns.categoryGroup),
    categoryLabel: cell(columns.category),
    categoryName: cell(columns.categoryName),
    cleared: cell(columns.cleared),
    date: cell(columns.date) ?? '',
    flag: cell(columns.flag),
    inflow: record[columns.inflow]?.trim() ?? '',
    line,
    memo: cell(columns.memo),
    outflow: record[columns.outflow]?.trim() ?? '',
    payee: cell(columns.payee),
  };
}

function buildResult(records: { info: { lines: number }; record: string[] }[], columns: Columns, options: YnabAdapterOptions): ImportParseResult {
  const lines = records.map(({ info, record }) => lineOf(record, info.lines, columns)).filter((line) => !isBlank(line));
  const warnings: ImportParseResult['warnings'] = [];
  const { order, warning } = resolveDateOrder(lines.flatMap((line) => (line.date ? [line.date] : [])), options.dateOrder);
  if (warning) warnings.push(warning);
  const decimal = decimalSeparatorOf(lines.flatMap((line) => [line.inflow, line.outflow]));

  const occurrences = new Map<string, Map<string, number>>();
  const accounts = new Map<string, ImportSourceAccount>();
  const categories = new Map<string, ImportSourceCategory>();
  const rows = lines.map((line): ParsedImportRow => {
    const label = line.account?.slice(0, 255);
    if (label) {
      const account = accounts.get(label) ?? { label, rowCount: 0 };
      account.rowCount += 1;
      accounts.set(label, account);
    }
    const row = rowFor(line, { decimal, label, occurrences, variant: columns.variant, order });
    const normalized = row.normalized;
    if (normalized?.categoryLabel) {
      const category = categories.get(normalized.categoryLabel) ?? { ...categoryOf(line)!, rowCount: 0 };
      category.rowCount += 1;
      categories.set(normalized.categoryLabel, category);
    }
    return row;
  });
  return { rows, sourceAccounts: [...accounts.values()], sourceCategories: [...categories.values()], warnings };
}

interface RowContext {
  decimal: DecimalSeparator;
  label: string | undefined;
  occurrences: Map<string, Map<string, number>>;
  order: DateOrder;
  variant: YnabVariant;
}

function rowFor(line: YnabLine, context: RowContext): ParsedImportRow {
  const raw = {
    account: line.account ?? '',
    category: line.categoryLabel ?? [line.categoryGroup, line.categoryName].filter(Boolean).join(': '),
    cleared: line.cleared ?? '',
    date: line.date,
    flag: line.flag ?? '',
    inflow: line.inflow,
    memo: line.memo ?? '',
    outflow: line.outflow,
    payee: line.payee ?? '',
  };
  const sourceRow = line.line;
  if (!context.label) return { error: 'Missing account', raw, sourceRow };
  const date = line.date ? parseOrderedDate(line.date, context.order) : undefined;
  if (!date) return { error: 'Unreadable date', raw, sourceRow };
  const inflow = parseAmount(line.inflow, context.decimal);
  const outflow = parseAmount(line.outflow, context.decimal);
  if (inflow === undefined || outflow === undefined) return { error: 'Unreadable amount', raw, sourceRow };
  const amount = roundCents(inflow - outflow);

  const merchant = line.payee?.slice(0, 255);
  const transferAccount = transferAccountOf(line.payee);
  const category = transferAccount ? undefined : categoryOf(line);
  const readyToAssign = category !== undefined && isReadyToAssign(category, context.variant);
  const description = (line.memo ?? merchant ?? (amount < 0 ? 'Payment' : 'Deposit')).slice(0, 500);

  const key = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}`;
  const seen = context.occurrences.get(context.label) ?? new Map<string, number>();
  context.occurrences.set(context.label, seen);
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);

  const normalized: NormalizedImportRow = {
    amount,
    date: date.toISOString(),
    description,
    externalId: `ynab-fp:${key}|${occurrence}`,
    externalIdTrusted: false,
    sourceAccountLabel: context.label,
    ...(merchant ? { merchant } : {}),
    ...(transferAccount ? { transferAccountLabel: transferAccount, typeHint: amount < 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN', typeIsUserSet: true } : {}),
    ...(readyToAssign ? { typeHint: 'DEPOSIT' } : {}),
    ...(category && !readyToAssign ? { categoryLabel: category.label } : {}),
  };
  return { normalized, raw, sourceRow };
}

/** The row's category, as the mapping step lists it; `undefined` when it has none. */
function categoryOf(line: YnabLine): Omit<ImportSourceCategory, 'rowCount'> | undefined {
  let group = line.categoryGroup?.slice(0, 120);
  let name = line.categoryName?.slice(0, 120);
  if (!name && line.categoryLabel) {
    // Only the combined `Group: Category` column is filled in: split it at its first colon.
    const separator = line.categoryLabel.indexOf(':');
    group = separator > 0 ? line.categoryLabel.slice(0, separator).trim() : group;
    name = (separator > 0 ? line.categoryLabel.slice(separator + 1) : line.categoryLabel).trim().slice(0, 120);
  }
  if (!name) return undefined;
  return { ...(group ? { group } : {}), label: (group ? `${group}: ${name}` : name).slice(0, 255), name };
}

/** YNAB's own inflow category: income that is not budgeted to a category yet. */
function isReadyToAssign(category: Omit<ImportSourceCategory, 'rowCount'>, variant: YnabVariant): boolean {
  const group = category.group?.toLowerCase();
  const name = category.name.toLowerCase();
  if (variant === 'ynab4') return group === 'income' && name.startsWith('available');
  return group === 'inflow' || name === 'ready to assign' || name === 'to be budgeted';
}

/** The other account of a `Transfer : <Account>` payee. */
function transferAccountOf(payee: string | undefined): string | undefined {
  const label = /^transfer\s*:\s*(.+)$/i.exec(payee ?? '')?.[1]?.trim();
  return label ? label.slice(0, 255) : undefined;
}

function isBlank(line: YnabLine): boolean {
  return !line.account && !line.date && !line.payee && !line.memo && line.inflow === '' && line.outflow === '';
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

type DecimalSeparator = ',' | '.';

/** The digits and separators of a cell, with the symbol, spaces and apostrophes gone. */
function numberPart(value: string): string {
  return value.replace(/[^\d.,]/g, '');
}

/**
 * The decimal separator the file's amounts use. Each cell votes when it can tell (both separators,
 * a repeated one, one not followed by exactly three digits); with no vote either way, a
 * separator before three digits is read as a thousands separator, so the decimal is `.`.
 */
function decimalSeparatorOf(cells: readonly string[]): DecimalSeparator {
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
function parseAmount(value: string, decimal: DecimalSeparator): number | undefined {
  const text = value.trim();
  if (text === '') return 0;
  const negative = /^\(.*\)$/.test(text) || /[-\u2212]/.test(text);
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

function roundCents(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
