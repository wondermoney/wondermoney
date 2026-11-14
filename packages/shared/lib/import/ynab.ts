import { parse } from 'csv-parse/sync';

import { type DateOrder, parseOrderedDate, resolveDateOrder } from './date-order';
import { decimalSeparatorOf, decodeRegister, type DecimalSeparator, delimiterOf, headerCellsOf, parseRegisterAmount, roundCents } from './register-csv';
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
 * currency symbol (`$1,234.56`, `1.234,56 €`), read as `register-csv.ts` reads any register amount.
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
  return columnsOf(headerCellsOf(input)) !== undefined;
}

export const ynabImportAdapter: ImportAdapter<YnabAdapterOptions> = {
  format: 'ynab',
  async parse(input, options) {
    const text = decodeRegister(input);
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
  const inflow = parseRegisterAmount(line.inflow, context.decimal);
  const outflow = parseRegisterAmount(line.outflow, context.decimal);
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
