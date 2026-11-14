import { parse } from 'csv-parse/sync';

import { type DateOrder, parseOrderedDate, resolveDateOrder } from './date-order';
import { normalizeName } from './name-match';
import { decimalSeparatorOf, decodeRegister, type DecimalSeparator, delimiterOf, headerCellsOf, parseRegisterAmount, roundCents } from './register-csv';
import type { ImportAdapter, ImportParseResult, ImportSourceAccount, ImportSourceCategory, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * Actual Budget transactions export reader, for the staged import session.
 *
 * Actual exports the transactions of an account, or of every account, as a CSV with the columns
 * `Account, Date, Payee, Notes, Category, Amount`, and since splits were exported in full also
 * `Split_Amount` and `Cleared` (an older export has `Cleared` and `Reconciled` as booleans). Dates
 * are ISO (`2026-01-31`) and amounts plain signed numbers (`-12.5`); a file a spreadsheet saved
 * again may have another delimiter, number format or date order, and those are read from the file
 * (`register-csv.ts`, `date-order.ts`). Its budget zip (SQLite) and sync server are not read.
 *
 * One file can hold every account, so each row names its source account (`Account`) and every
 * account is listed for the mapping step, even when there is only one.
 *
 * ## Transfers
 *
 * Actual names a transfer's payee after the other account, so a payee that reads as another
 * account of the file (case and accents aside) is one side of a transfer, and so is a
 * `Transfer: <Account>` payee whatever the account. The row is typed as the transfer its sign
 * states, with the other account named, and when both sides are imported transfer matching links
 * them. A transfer has no category.
 *
 * ## Splits
 *
 * A split is written as its parent, `(SPLIT INTO n)` in its notes, an amount of 0 and its total in
 * `Split_Amount`, and its n parts, `(SPLIT i OF n)` in theirs, on the same account and day. It
 * imports as one transaction for the parent's total (or, without `Split_Amount`, the parts' sum),
 * with each part's category, amount and note in the transaction's notes; the category every part
 * shares, when they share one, is the row's. A part whose parent is not in the file imports as a
 * row of its own.
 *
 * Every other category is listed for the category-mapping step. Actual's export states no
 * transaction id, so every row is a fingerprint of its date and amount within its account: the
 * same export read again finds its rows as duplicates.
 */

export interface ActualAdapterOptions {
  /** How an ambiguous date reads. Absent, the file's own dates decide, and the reader asks. */
  dateOrder?: DateOrder;
}

/** The file is not an Actual Budget transactions export at all (its columns are missing, or it is not CSV). */
export class ActualUnreadableError extends Error {
  constructor(readonly code: 'columns_not_found' | 'unreadable' = 'unreadable') {
    super(code === 'columns_not_found' ? 'This file is not an Actual Budget export' : 'Could not read the Actual Budget export');
    this.name = 'ActualUnreadableError';
  }
}

interface Columns {
  account: number;
  amount: number;
  category: number;
  cleared?: number;
  date: number;
  notes: number;
  payee: number;
  splitAmount?: number;
}

/** The columns of an Actual export header, or `undefined` when the header is not one. */
function columnsOf(header: readonly string[]): Columns | undefined {
  const index = new Map(header.map((name, position) => [name.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_]+/g, '_'), position] as const));
  const at = (name: string) => index.get(name);
  const [account, date, payee, notes, category, amount] = ['account', 'date', 'payee', 'notes', 'category', 'amount'].map(at);
  if (account === undefined || date === undefined || payee === undefined || notes === undefined || category === undefined || amount === undefined) return undefined;
  // A YNAB register has an Account, Date and Payee too, but its money is in Outflow and Inflow.
  if (at('outflow') !== undefined || at('inflow') !== undefined) return undefined;
  return { account, amount, category, cleared: at('cleared'), date, notes, payee, splitAmount: at('split_amount') };
}

/** Whether the bytes look like an Actual Budget transactions export: a header with Actual's columns. */
export function isActualFile(input: Uint8Array): boolean {
  return columnsOf(headerCellsOf(input)) !== undefined;
}

export const actualImportAdapter: ImportAdapter<ActualAdapterOptions> = {
  format: 'actual',
  async parse(input, options) {
    const text = decodeRegister(input);
    let records: { info: { lines: number }; record: string[] }[];
    try {
      records = parse(text, { delimiter: delimiterOf(text.split(/\r\n|\r|\n/, 1)[0] ?? ''), info: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as unknown as typeof records;
    } catch {
      throw new ActualUnreadableError('unreadable');
    }
    const [header, ...lines] = records;
    const columns = header ? columnsOf(header.record) : undefined;
    if (!columns) throw new ActualUnreadableError('columns_not_found');
    return buildResult(lines, columns, options);
  },
};

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

type SplitMarker = { count: number; kind: 'parent' } | { kind: 'part'; of: number };

interface ActualLine {
  account?: string;
  amount: string;
  category?: string;
  cleared?: string;
  date: string;
  line: number;
  /** The note without its split marker. */
  note?: string;
  notes?: string;
  payee?: string;
  split?: SplitMarker;
  splitAmount: string;
}

const PARENT_MARKER = /^\(SPLIT INTO (\d+)\)\s*/i;
const PART_MARKER = /^\(SPLIT (\d+) OF (\d+)\)\s*/i;

function lineOf(record: string[], line: number, columns: Columns): ActualLine {
  const cell = (position: number | undefined) => (position === undefined ? undefined : clean(record[position], 1000));
  const notes = cell(columns.notes);
  const parent = PARENT_MARKER.exec(notes ?? '');
  const part = parent ? null : PART_MARKER.exec(notes ?? '');
  const split: SplitMarker | undefined = parent ? { count: Number(parent[1]), kind: 'parent' } : part ? { kind: 'part', of: Number(part[2]) } : undefined;
  const marker = parent ?? part;
  return {
    account: cell(columns.account),
    amount: record[columns.amount]?.trim() ?? '',
    category: cell(columns.category),
    cleared: cell(columns.cleared),
    date: cell(columns.date) ?? '',
    line,
    note: (marker ? clean(notes?.slice(marker[0].length), 1000) : notes),
    notes,
    payee: cell(columns.payee),
    split,
    splitAmount: columns.splitAmount === undefined ? '' : (record[columns.splitAmount]?.trim() ?? ''),
  };
}

/**
 * Each split parent's parts, by the parent's index. A part belongs to the parent of the same
 * account and day that names the same number of parts and still has room, whether it comes after
 * the parent (as Actual writes it) or before. A part no parent takes is left out of the result.
 */
function splitPartsOf(lines: readonly ActualLine[]): Map<number, number[]> {
  const parts = new Map<number, number[]>();
  const open = new Map<string, number>();
  const waiting = new Map<string, number[]>();
  const keyOf = (line: ActualLine, count: number) => `${line.account ?? ''}|${line.date}|${count}`;
  lines.forEach((line, index) => {
    if (line.split?.kind === 'parent') {
      const key = keyOf(line, line.split.count);
      const early = waiting.get(key) ?? [];
      const taken = early.splice(0, line.split.count);
      parts.set(index, taken);
      if (taken.length < line.split.count) open.set(key, index);
    } else if (line.split?.kind === 'part') {
      const key = keyOf(line, line.split.of);
      const parent = open.get(key);
      if (parent === undefined) {
        waiting.set(key, [...(waiting.get(key) ?? []), index]);
        return;
      }
      const taken = parts.get(parent)!;
      taken.push(index);
      if (taken.length >= line.split.of) open.delete(key);
    }
  });
  return parts;
}

function buildResult(records: { info: { lines: number }; record: string[] }[], columns: Columns, options: ActualAdapterOptions): ImportParseResult {
  const lines = records.map(({ info, record }) => lineOf(record, info.lines, columns)).filter((line) => !isBlank(line));
  const warnings: ImportParseResult['warnings'] = [];
  const { order, warning } = resolveDateOrder(lines.flatMap((line) => (line.date ? [line.date] : [])), options.dateOrder);
  if (warning) warnings.push(warning);
  const decimal = decimalSeparatorOf(lines.flatMap((line) => [line.amount, line.splitAmount]));
  const accountsByName = new Map<string, string>();
  for (const line of lines) {
    const label = line.account?.slice(0, 255);
    if (label && !accountsByName.has(normalizeName(label))) accountsByName.set(normalizeName(label), label);
  }

  const parts = splitPartsOf(lines);
  const partIndexes = new Set([...parts.values()].flat());
  const context: RowContext = { accountsByName, decimal, occurrences: new Map(), order };
  const accounts = new Map<string, ImportSourceAccount>();
  const categories = new Map<string, ImportSourceCategory>();
  const rows: ParsedImportRow[] = [];
  lines.forEach((line, index) => {
    if (partIndexes.has(index)) return;
    const row = rowFor(line, (parts.get(index) ?? []).map((part) => lines[part]!), context);
    const label = row.normalized?.sourceAccountLabel ?? line.account?.slice(0, 255);
    if (label) {
      const account = accounts.get(label) ?? { label, rowCount: 0 };
      account.rowCount += 1;
      accounts.set(label, account);
    }
    const categoryLabel = row.normalized?.categoryLabel;
    if (categoryLabel) {
      const category = categories.get(categoryLabel) ?? { ...categoryOf(categoryLabel), rowCount: 0 };
      category.rowCount += 1;
      categories.set(categoryLabel, category);
    }
    rows.push(row);
  });
  return { rows, sourceAccounts: [...accounts.values()], sourceCategories: [...categories.values()], warnings };
}

interface RowContext {
  /** The file's accounts by their normalized name, for a payee that names one. */
  accountsByName: ReadonlyMap<string, string>;
  decimal: DecimalSeparator;
  occurrences: Map<string, Map<string, number>>;
  order: DateOrder;
}

function rowFor(line: ActualLine, parts: readonly ActualLine[], context: RowContext): ParsedImportRow {
  const raw = {
    account: line.account ?? '',
    amount: line.amount,
    category: line.category ?? '',
    cleared: line.cleared ?? '',
    date: line.date,
    notes: line.notes ?? '',
    payee: line.payee ?? '',
    ...(parts.length > 0 || line.splitAmount !== '' ? { splitAmount: line.splitAmount } : {}),
  };
  const sourceRow = line.line;
  const label = line.account?.slice(0, 255);
  if (!label) return { error: 'Missing account', raw, sourceRow };
  const date = line.date ? parseOrderedDate(line.date, context.order) : undefined;
  if (!date) return { error: 'Unreadable date', raw, sourceRow };
  const amount = amountOf(line, parts, context.decimal);
  if (amount === undefined) return { error: 'Unreadable amount', raw, sourceRow };

  const merchant = line.payee?.slice(0, 255);
  const transferAccount = transferAccountOf(line.payee, label, context.accountsByName);
  const category = transferAccount ? undefined : categoryLabelOf(line, parts);
  const description = (line.note ?? merchant ?? (amount < 0 ? 'Payment' : 'Deposit')).slice(0, 500);
  const notes = parts.length > 0 ? notesOf(parts, context.decimal) : undefined;

  const key = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}`;
  const seen = context.occurrences.get(label) ?? new Map<string, number>();
  context.occurrences.set(label, seen);
  const occurrence = seen.get(key) ?? 0;
  seen.set(key, occurrence + 1);

  const normalized: NormalizedImportRow = {
    amount,
    date: date.toISOString(),
    description,
    externalId: `actual-fp:${key}|${occurrence}`,
    externalIdTrusted: false,
    sourceAccountLabel: label,
    ...(merchant ? { merchant } : {}),
    ...(notes ? { notes } : {}),
    ...(transferAccount ? { transferAccountLabel: transferAccount, typeHint: amount < 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN', typeIsUserSet: true } : {}),
    ...(category ? { categoryLabel: category } : {}),
  };
  return { normalized, raw, sourceRow };
}

/**
 * The row's amount: a split parent's `Split_Amount` (Actual writes the parent's `Amount` as 0), or
 * the sum of its parts when the file has no total; any other row's `Amount`. An empty cell does
 * not read.
 */
function amountOf(line: ActualLine, parts: readonly ActualLine[], decimal: DecimalSeparator): number | undefined {
  if (line.split?.kind === 'parent') {
    const total = line.splitAmount === '' ? undefined : parseRegisterAmount(line.splitAmount, decimal);
    if (total !== undefined && total !== 0) return roundCents(total);
    const own = line.amount === '' ? undefined : parseRegisterAmount(line.amount, decimal);
    if (own !== undefined && own !== 0) return roundCents(own);
    let sum = 0;
    for (const part of parts) {
      const value = part.amount === '' ? undefined : parseRegisterAmount(part.amount, decimal);
      if (value === undefined) return undefined;
      sum += value;
    }
    return roundCents(sum);
  }
  if (line.amount === '') return undefined;
  const amount = parseRegisterAmount(line.amount, decimal);
  return amount === undefined ? undefined : roundCents(amount);
}

/** A split's parts, as the transaction's notes: each part's category (or payee), amount and note. */
function notesOf(parts: readonly ActualLine[], decimal: DecimalSeparator): string | undefined {
  const text = parts
    .map((part) => {
      const amount = part.amount === '' ? undefined : parseRegisterAmount(part.amount, decimal);
      const name = part.category ?? part.payee;
      return [name, amount === undefined ? part.amount : roundCents(amount).toFixed(2)].filter(Boolean).join(' ') + (part.note ? ` (${part.note})` : '');
    })
    .join('; ');
  if (!text) return undefined;
  return text.length > 255 ? `${text.slice(0, 254)}…` : text;
}

/** The row's category: its own, or for a split the one every part shares. */
function categoryLabelOf(line: ActualLine, parts: readonly ActualLine[]): string | undefined {
  if (parts.length === 0) return line.category?.slice(0, 255);
  const shared = new Set(parts.map((part) => part.category));
  const [only] = shared;
  return shared.size === 1 && only ? only.slice(0, 255) : undefined;
}

/** A category label as the mapping step lists it; an older export writes `Group: Category`. */
function categoryOf(label: string): Omit<ImportSourceCategory, 'rowCount'> {
  const separator = label.indexOf(':');
  const group = separator > 0 ? label.slice(0, separator).trim().slice(0, 120) : undefined;
  const name = (separator > 0 ? label.slice(separator + 1).trim() : label).slice(0, 120) || label.slice(0, 120);
  return { ...(group ? { group } : {}), label, name };
}

/**
 * The other account of a transfer: a `Transfer: <Account>` payee, or a payee that reads as another
 * account of the file (Actual names a transfer's payee after the account). Named as the file names
 * that account when it holds it.
 */
function transferAccountOf(payee: string | undefined, own: string, accountsByName: ReadonlyMap<string, string>): string | undefined {
  if (!payee) return undefined;
  const stated = /^transfer\s*:\s*(.+)$/i.exec(payee)?.[1]?.trim();
  const name = normalizeName(stated ?? payee);
  const inFile = accountsByName.get(name);
  if (inFile !== undefined) return inFile === own ? undefined : inFile;
  return stated ? stated.slice(0, 255) : undefined;
}

function isBlank(line: ActualLine): boolean {
  return !line.account && !line.date && !line.payee && !line.notes && line.amount === '' && line.splitAmount === '';
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : undefined;
}
