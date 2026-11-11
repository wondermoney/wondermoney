import type { ImportAdapter, ImportParseResult, ImportSourceAccount, ImportWarning, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * QIF (Quicken Interchange Format) statement reader, for the staged import session.
 *
 * QIF is a line-oriented text format. A `!Type:` line names the list that follows (`Bank`, `CCard`,
 * `Cash`, `Oth A`, `Oth L`), each record is a run of one-letter fields ended by `^`, and the fields
 * read here are `D` (date), `T`/`U` (amount), `P` (payee), `M` (memo), `L` (category or, in
 * brackets, the other account of a transfer) and `N` (check number). Amounts are signed as the file
 * writes them: negative is money leaving the account, for every list type.
 *
 * A record's `S`/`E`/`$` split lines keep the record's own total (`T`); the breakdown is appended to
 * the description, so the row imports as one transaction with the amount the file states.
 *
 * ## Dates
 *
 * QIF has no standard date format: a file may write `1/15/2026`, `15/01/2026`, `1/15/26` or
 * Quicken's `1/15'26`. The reader looks at every date in the file: a first part above 12 makes the
 * file day-first, a second part above 12 makes it month-first. When every date is ambiguous (both
 * parts 12 or less) the file cannot say, so the adapter reads them day-first and reports
 * `date_order_ambiguous`; the session asks the person, and reads the file again with `dateOrder`.
 * Two-digit years are 2000-2049 for 00-49 and 1950-1999 for 50-99.
 *
 * ## Accounts
 *
 * A file with no `!Account` block is for the one account the import was started on. Each `!Account`
 * block (a name in `N`) opens a source account for the transactions that follow it; a file with
 * more than one asks for a mapping.
 */

/** How a QIF date whose day and month are both 12 or less reads. */
export type QifDateOrder = 'day-first' | 'month-first';

export interface QifAdapterOptions {
  /** How an ambiguous date reads. Absent, the file's own dates decide, and the reader asks. */
  dateOrder?: QifDateOrder;
}

/** The file is not a QIF document at all. */
export class QifUnreadableError extends Error {
  constructor(readonly code: 'not_qif' | 'unreadable' = 'unreadable') {
    super(code === 'not_qif' ? 'This file is not a QIF document' : 'Could not read the QIF file');
    this.name = 'QifUnreadableError';
  }
}

/** Whether the bytes look like a QIF document: a `!Type:`, `!Account` or `!Option:` header line. */
export function isQifFile(input: Uint8Array): boolean {
  const bytes = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  return /^[ \t]*!(?:Type|Option|Clear)[ \t]*:/im.test(head) || /^[ \t]*!Account[ \t]*$/im.test(head);
}

export const qifImportAdapter: ImportAdapter<QifAdapterOptions> = {
  format: 'qif',
  async parse(input, options) {
    const text = decodeQif(input);
    const { groups, sawHeader, warnings } = scan(text);
    if (!sawHeader && groups.every((group) => group.records.length === 0)) throw new QifUnreadableError('not_qif');
    return buildResult(groups, warnings, options);
  },
};

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

/** QIF is ASCII or a Windows code page; a file that is valid UTF-8 is read as UTF-8. */
function decodeQif(input: Uint8Array): string {
  const bytes = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

// ---------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------

interface QifSplit {
  amount?: string;
  category?: string;
  memo?: string;
}

interface QifRecord {
  address: string[];
  amount?: string;
  /** The duplicate amount field some exports write instead of `T`. */
  amountAlt?: string;
  category?: string;
  checkNumber?: string;
  cleared?: string;
  date?: string;
  /** The line in the file the record starts on, 1-based. */
  line: number;
  memo?: string;
  payee?: string;
  splits: QifSplit[];
}

interface QifGroup {
  accountType?: string;
  label: string;
  records: QifRecord[];
}

/** The `!Type:` lists that hold transactions; every other list (categories, memorised, prices) is skipped. */
const TRANSACTION_LISTS: ReadonlySet<string> = new Set(['bank', 'cash', 'ccard', 'oth a', 'oth l']);

function scan(text: string): { groups: QifGroup[]; sawHeader: boolean; warnings: ImportWarning[] } {
  const lines = text.split(/\r\n|\r|\n/);
  const groups: QifGroup[] = [];
  const byLabel = new Map<string, QifGroup>();
  const warnings: ImportWarning[] = [];
  let current: QifGroup | undefined;
  let pendingAccount: { name?: string; type?: string } | undefined;
  let section: 'account' | 'skip' | 'transactions' = 'transactions';
  let record: QifRecord | undefined;
  let split: QifSplit | undefined;
  let sawHeader = false;
  let investmentWarned = false;

  const groupFor = (name: string | undefined, accountType: string | undefined): QifGroup => {
    const label = name?.trim() || `Account ${groups.length + 1}`;
    const existing = byLabel.get(label);
    if (existing) return existing;
    const group: QifGroup = { label, records: [] };
    if (accountType) group.accountType = accountType;
    groups.push(group);
    byLabel.set(label, group);
    return group;
  };

  const finishSplit = () => {
    if (split && record) record.splits.push(split);
    split = undefined;
  };

  const finishRecord = () => {
    finishSplit();
    if (!record) return;
    const empty =
      record.date === undefined &&
      record.amount === undefined &&
      record.amountAlt === undefined &&
      record.payee === undefined &&
      record.memo === undefined &&
      record.category === undefined &&
      record.splits.length === 0;
    if (!empty) {
      const group = current ?? groupFor(undefined, undefined);
      current = group;
      group.records.push(record);
    }
    record = undefined;
  };

  const ensureRecord = (line: number): QifRecord => {
    record ??= { address: [], line, splits: [] };
    return record;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    const lineNumber = index + 1;

    if (line.startsWith('!')) {
      const header = /^!\s*([A-Za-z]+)\s*:?\s*(.*)$/.exec(line);
      const name = (header?.[1] ?? '').toLowerCase();
      const value = (header?.[2] ?? '').trim();
      if (name === 'account') {
        finishRecord();
        sawHeader = true;
        pendingAccount = {};
        section = 'account';
      } else if (name === 'type') {
        finishRecord();
        sawHeader = true;
        pendingAccount = undefined;
        const list = value.toLowerCase();
        if (TRANSACTION_LISTS.has(list)) {
          section = 'transactions';
        } else {
          section = 'skip';
          if (list === 'invst' && !investmentWarned) {
            investmentWarned = true;
            warnings.push({ code: 'investment_records_skipped', detail: value, sourceRow: lineNumber });
          }
        }
      }
      // `!Option:` and `!Clear:` only switch the exporting program's behaviour.
      continue;
    }

    if (section === 'account') {
      if (line === '^') {
        current = groupFor(pendingAccount?.name, pendingAccount?.type);
        pendingAccount = undefined;
        section = 'transactions';
        continue;
      }
      const code = line[0];
      const value = line.slice(1).trim();
      if (code === 'N') pendingAccount!.name = value;
      else if (code === 'T') pendingAccount!.type = value;
      continue;
    }

    if (section === 'skip') continue;

    const code = line[0]!;
    const value = line.slice(1).trim();
    switch (code) {
      case '^':
        finishRecord();
        break;
      case 'D':
        ensureRecord(lineNumber).date = value;
        break;
      case 'T':
        ensureRecord(lineNumber).amount = value;
        break;
      case 'U':
        ensureRecord(lineNumber).amountAlt = value;
        break;
      case 'P':
        ensureRecord(lineNumber).payee = value;
        break;
      case 'M':
        ensureRecord(lineNumber).memo = value;
        break;
      case 'L':
        ensureRecord(lineNumber).category = value;
        break;
      case 'N':
        ensureRecord(lineNumber).checkNumber = value;
        break;
      case 'C':
        ensureRecord(lineNumber).cleared = value;
        break;
      case 'A':
        ensureRecord(lineNumber).address.push(value);
        break;
      case 'S':
        finishSplit();
        split = { category: value };
        ensureRecord(lineNumber);
        break;
      case 'E':
        if (split) split.memo = value;
        break;
      case '$':
        if (split) split.amount = value;
        break;
      default:
        // A field this reader does not use (address lines, investment fields, split percentages).
        break;
    }
  }
  finishRecord();
  return { groups, sawHeader, warnings };
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

function buildResult(groups: QifGroup[], warnings: ImportWarning[], options: QifAdapterOptions): ImportParseResult {
  const kinds = new Set<QifDateKind>();
  for (const group of groups) for (const record of group.records) if (record.date !== undefined) kinds.add(classifyQifDate(record.date));
  const { ambiguous, conflict, order } = chooseDateOrder(kinds, options.dateOrder);
  if (options.dateOrder === undefined) {
    if (conflict) warnings.push({ code: 'date_order_conflict', detail: order });
    else if (ambiguous) warnings.push({ code: 'date_order_ambiguous', detail: order });
  }

  const multiple = groups.length > 1;
  const rows: ParsedImportRow[] = [];
  const sourceAccounts: ImportSourceAccount[] = [];
  for (const group of groups) {
    const occurrences = new Map<string, number>();
    const groupRows = group.records.map((record) => rowFor(record, { label: multiple ? group.label : undefined, occurrences, order }));
    rows.push(...groupRows);
    if (multiple) sourceAccounts.push({ label: group.label, rowCount: groupRows.length });
  }
  return { rows, sourceAccounts, warnings };
}

interface RowContext {
  label?: string;
  occurrences: Map<string, number>;
  order: QifDateOrder;
}

function rowFor(record: QifRecord, context: RowContext): ParsedImportRow {
  const raw = {
    amount: record.amount ?? record.amountAlt ?? '',
    category: record.category ?? '',
    checkNumber: record.checkNumber ?? '',
    date: record.date ?? '',
    memo: record.memo ?? '',
    payee: record.payee ?? '',
    splits: record.splits.map((split) => ({ amount: split.amount ?? '', category: split.category ?? '', memo: split.memo ?? '' })),
  };
  const date = record.date === undefined ? undefined : parseQifDate(record.date, context.order);
  const amount = parseQifAmount(record.amount ?? record.amountAlt ?? '');
  if (!date) return { error: 'Unreadable date', raw, sourceRow: record.line };
  if (amount === undefined) return { error: 'Unreadable amount', raw, sourceRow: record.line };

  const merchant = clean(record.payee, 255);
  const category = categoryOf(record.category);
  const transferAccount = transferAccountOf(record.category);
  const splitNote = splitNoteOf(record.splits);
  const description = truncate(
    [clean(record.memo, 500) ?? merchant ?? category ?? (amount < 0 ? 'Payment' : 'Deposit'), splitNote].filter((part): part is string => part !== undefined).join(' — '),
    500,
  );

  // QIF states no transaction id, so every row is a fingerprint: the same file read again finds it.
  const key = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}`;
  const occurrence = context.occurrences.get(key) ?? 0;
  context.occurrences.set(key, occurrence + 1);

  const normalized: NormalizedImportRow = {
    amount,
    date: date.toISOString(),
    description,
    externalId: `qif-fp:${key}|${occurrence}`,
    externalIdTrusted: false,
    ...(category ? { categoryLabel: category } : {}),
    ...(merchant ? { merchant } : {}),
    ...(transferAccount
      ? { transferAccountLabel: transferAccount, typeHint: amount < 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN', typeIsUserSet: true }
      : {}),
    ...(context.label ? { sourceAccountLabel: context.label } : {}),
  };
  return { normalized, raw, sourceRow: record.line };
}

/** The split lines as one note for the description; the record's own total is the amount. */
function splitNoteOf(splits: QifSplit[]): string | undefined {
  const parts: string[] = [];
  for (const split of splits) {
    const amount = parseQifAmount(split.amount ?? '');
    if (amount === undefined) continue;
    parts.push(`${clean(split.category, 120) ?? clean(split.memo, 120) ?? 'Split'} ${amount.toFixed(2)}`);
  }
  return parts.length > 0 ? `Split: ${parts.join('; ')}` : undefined;
}

/** The other account of a transfer category (`L[Account]`, or `L[Account]/Class`). */
function transferAccountOf(category: string | undefined): string | undefined {
  const label = /^\s*\[([^\]]*)\]/.exec(category ?? '')?.[1]?.trim();
  return label ? label : undefined;
}

/** The file's category, without the class a `/` introduces (`Food:Groceries/Personal`). */
function categoryOf(category: string | undefined): string | undefined {
  const text = category?.trim();
  if (!text || transferAccountOf(text)) return undefined;
  return clean(text.split('/')[0], 255);
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

type QifDateKind = 'ambiguous' | 'day-first' | 'month-first' | 'unreadable' | 'year-first';

type QifDateShape = { day: number; kind: 'year-first'; month: number; year: number } | { first: number; kind: 'two-part'; second: number; year: number };

/** The three numbers of a date, with the year resolved; `undefined` when it is not a date at all. */
function shapeOf(value: string): QifDateShape | undefined {
  const parts = value
    .trim()
    .split(/['\-/.]/)
    .map((part) => part.trim());
  if (parts.length !== 3) return undefined;
  const [first, second, third] = parts;
  if (!/^\d{1,4}$/.test(first ?? '') || !/^\d{1,4}$/.test(second ?? '') || !/^\d{1,4}$/.test(third ?? '')) return undefined;
  const a = Number(first);
  const b = Number(second);
  const c = Number(third);
  // A four-digit first part is a year: the file is ISO-ordered (year, month, day).
  if ((first ?? '').length === 4) return { day: c, kind: 'year-first', month: b, year: a };
  const year = expandYear(c, (third ?? '').length);
  return year === undefined ? undefined : { first: a, kind: 'two-part', second: b, year };
}

/** Quicken's two-digit years: 00-49 are 2000-2049, 50-99 are 1950-1999. */
function expandYear(value: number, digits: number): number | undefined {
  if (digits >= 3) return value;
  if (value > 99) return undefined;
  return value < 50 ? 2000 + value : 1900 + value;
}

function classifyQifDate(value: string): QifDateKind {
  const shape = shapeOf(value);
  if (!shape) return 'unreadable';
  if (shape.kind === 'year-first') return toDate(shape.year, shape.month, shape.day) ? 'year-first' : 'unreadable';
  if (shape.first > 12 && shape.second > 12) return 'unreadable';
  if (shape.first > 12) return 'day-first';
  if (shape.second > 12) return 'month-first';
  return 'ambiguous';
}

function parseQifDate(value: string, order: QifDateOrder): Date | undefined {
  const shape = shapeOf(value);
  if (!shape) return undefined;
  if (shape.kind === 'year-first') return toDate(shape.year, shape.month, shape.day);
  const dayFirst = order === 'day-first';
  return toDate(shape.year, dayFirst ? shape.second : shape.first, dayFirst ? shape.first : shape.second);
}

function toDate(year: number, month: number, day: number): Date | undefined {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

/**
 * The order the file reads in. A date with a part above 12 settles it; when every date is
 * ambiguous the file cannot say, and `ambiguous` asks the person (reading day-first meanwhile).
 */
function chooseDateOrder(kinds: ReadonlySet<QifDateKind>, option: QifDateOrder | undefined): { ambiguous: boolean; conflict: boolean; order: QifDateOrder } {
  if (option !== undefined) return { ambiguous: false, conflict: false, order: option };
  const dayFirst = kinds.has('day-first');
  const monthFirst = kinds.has('month-first');
  if (dayFirst && monthFirst) return { ambiguous: false, conflict: true, order: 'day-first' };
  if (monthFirst) return { ambiguous: false, conflict: false, order: 'month-first' };
  return { ambiguous: !dayFirst && kinds.has('ambiguous'), conflict: false, order: 'day-first' };
}

// ---------------------------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------------------------

/** QIF writes a decimal point; a comma decimal separator is tolerated for exports that break the spec. */
function parseQifAmount(value: string): number | undefined {
  let text = value.trim().replace(/\s+/g, '').replace(/[^\d,.\-+]/g, '');
  if (text === '' || text === '-' || text === '+' || text === '.' || text === ',') return undefined;
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, '').replace(/,/g, '.') : text.replace(/,/g, '');
  } else if (comma >= 0) {
    const parts = text.split(',');
    const fraction = parts[1] ?? '';
    text = parts.length === 2 && fraction.length > 0 && fraction.length <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (dot >= 0) {
    const parts = text.split('.');
    if (parts.length > 2) text = parts.join('');
  }
  const amount = Number(text);
  if (!Number.isFinite(amount)) return undefined;
  const rounded = Math.round(amount * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}
