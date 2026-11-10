import { createHash } from 'node:crypto';

import { csv } from '@wondermoney/shared';
import { parse } from 'csv-parse/sync';

import { DEFAULT_CSV_UPLOAD_LIMITS } from '@service/account/csv-upload-boundary.service';

import type { StatementColumnField, StatementColumns, StatementDateFormat, StatementMapping } from './account-statement-mapping.schema';

/**
 * Reads a bank statement export whatever bank wrote it: CSV in any delimiter or encoding, or a
 * spreadsheet (XLS, XLSX, or the HTML table some banks save as .xls). Everything here is pure: the
 * grid in, a mapping or parsed rows out, so the preview the person sees and the import the
 * worker runs read the file the same way.
 */

export interface AppliedStatement {
  invalid: { reason: string; row: number }[];
  rows: StatementRow[];
}

export type StatementGrid = string[][];

export interface StatementRow {
  amount: number;
  currency?: string;
  date: Date;
  description: string;
  /** Stable across imports of the same line, so a re-import or an overlapping export skips it. */
  internalTransactionId: string;
  /** The file's own row number, 1-based, as a spreadsheet shows it. */
  sourceRow: number;
}

/** What the model may see of a column: its name and the kinds of value in it, never the values. */
export interface StatementColumnProfile {
  /** Values of a column with at most four short distinct values (a "D"/"C" marker). */
  dateShare: number;
  distinctValues?: string[];
  emptyShare: number;
  header: string;
  index: number;
  negativeShare: number;
  numberShare: number;
}

const HEADER_SCAN_ROWS = 40;
const DATA_SCAN_ROWS = 60;

// ---------------------------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------------------------

export async function readStatementGrid(buffer: Buffer): Promise<StatementGrid> {
  const grid = isSpreadsheet(buffer) ? normalizeSpreadsheetRows((await csv.parseExcel(buffer)) as unknown[][]) : parseDelimitedText(decodeText(buffer));
  if (grid.length > DEFAULT_CSV_UPLOAD_LIMITS.maxRows) throw new Error(`CSV exceeds max row count of ${DEFAULT_CSV_UPLOAD_LIMITS.maxRows}`);
  if (grid.some((row) => row.length > DEFAULT_CSV_UPLOAD_LIMITS.maxColumns)) throw new Error(`CSV exceeds max column count of ${DEFAULT_CSV_UPLOAD_LIMITS.maxColumns}`);
  return grid.map((row) => row.map((cell) => cell.slice(0, DEFAULT_CSV_UPLOAD_LIMITS.maxFieldLength).trim()));
}

function isSpreadsheet(buffer: Buffer) {
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b; // XLSX
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0; // XLS
  const head = buffer.subarray(0, 512).toString('latin1').trimStart().toLowerCase();
  const html = head.startsWith('<') && (head.includes('<table') || head.includes('<html'));
  return zip || ole || html;
}

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252, which Portuguese and Spanish banks still export. */
export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function parseDelimitedText(text: string): StatementGrid {
  const rows: StatementGrid = parse(text, { bom: true, delimiter: sniffDelimiter(text), relax_column_count: true, relax_quotes: true, skip_empty_lines: false });
  return rows;
}

/** The delimiter that splits the most lines into the same number of cells. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, 50);
  let best = { delimiter: ',', mode: 0, score: 0 };
  for (const delimiter of [';', ',', '\t', '|']) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const frequency = new Map<number, number>();
    for (const count of counts) if (count > 0) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    for (const [mode, lineCount] of frequency) {
      if (lineCount > best.score || (lineCount === best.score && mode > best.mode)) best = { delimiter, mode, score: lineCount };
    }
  }
  return best.delimiter;
}

function countOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char === delimiter) count++;
  }
  return count;
}

function normalizeSpreadsheetRows(rows: unknown[][]): StatementGrid {
  return rows.map((row) => row.map((cell) => {
    if (cell === null || cell === undefined) return '';
    if (cell instanceof Date) return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
    return String(cell);
  }));
}

const pad = (value: number) => String(value).padStart(2, '0');

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

const DATE_PATTERN = /^(\d{1,4})[./\-\s](\d{1,2})[./\-\s](\d{1,4})(?:[ T].*)?$/;
const COMPACT_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

export function isDateLike(value: string) {
  return (['DMY', 'MDY'] as const).some((format) => parseStatementDate(value, format) !== undefined);
}

export function parseStatementDate(value: string, format: StatementDateFormat): Date | undefined {
  const parts = dateParts(value);
  if (!parts) return undefined;
  const yearFirst = /^\d{4}/.test(value.trim());
  const [year, month, day] = yearFirst || format === 'YMD' ? parts : format === 'MDY' ? [parts[2], parts[0], parts[1]] : [parts[2], parts[1], parts[0]];
  const fullYear = year < 100 ? 2000 + year : year;
  if (month < 1 || month > 12 || day < 1 || day > 31 || fullYear < 1970 || fullYear > 2100) return undefined;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date : undefined;
}

function dateParts(value: string): [number, number, number] | undefined {
  const compact = COMPACT_DATE_PATTERN.exec(value);
  if (compact) return [Number(compact[1]), Number(compact[2]), Number(compact[3])];
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const [first, second, third] = [match[1]!, match[2]!, match[3]!];
  if (first.length === 3 || third.length === 3) return undefined;
  if (first.length === 4 && third.length === 4) return undefined;
  return [Number(first), Number(second), Number(third)];
}

/** DMY unless a day past 12 says otherwise; `ambiguous` when no value decides it. */
export function inferDateFormat(values: string[]): { ambiguous: boolean; format: StatementDateFormat } {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    if (/^\d{4}/.test(value.trim())) return { ambiguous: false, format: 'YMD' };
    const parts = dateParts(value);
    if (!parts) continue;
    if (parts[0] > 12) dayFirst = true;
    if (parts[1] > 12) monthFirst = true;
  }
  if (monthFirst && !dayFirst) return { ambiguous: false, format: 'MDY' };
  return { ambiguous: !dayFirst && !monthFirst, format: 'DMY' };
}

const NUMBER_PATTERN = /^[+-]?\(?[+-]?[\s',.]*\d[\s\d',.]*\)?-?$/;

export function isNumberLike(value: string) {
  const stripped = stripCurrency(value);
  return stripped !== '' && NUMBER_PATTERN.test(stripped) && /\d/.test(stripped);
}

export function parseStatementAmount(value: string, decimalSeparator: ',' | '.'): number | undefined {
  let text = stripCurrency(value);
  if (!text || !isNumberLike(text)) return undefined;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) { negative = true; text = text.slice(1, -1); }
  if (text.endsWith('-')) { negative = true; text = text.slice(0, -1); }
  if (text.startsWith('-')) { negative = !negative; text = text.slice(1); } else if (text.startsWith('+')) text = text.slice(1);
  text = text.replace(/[\s']/g, '');
  text = decimalSeparator === ',' ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

function stripCurrency(value: string) {
  return value.replace(/[€$£¥]|(?<![a-z])[a-z]{3}(?![a-z])/gi, '').trim();
}

/** The separator that ends values in one or two decimals; a comma wins a tie, as in European exports. */
export function inferDecimalSeparator(values: string[]): ',' | '.' {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const value = stripCurrency(raw).replace(/-$|^\(|\)$/g, '');
    const match = /([.,])(\d+)$/.exec(value);
    if (!match) continue;
    const [, separator, digits] = match;
    const other = separator === ',' ? '.' : ',';
    if (digits!.length !== 3 || value.includes(other)) {
      if (separator === ',') comma++; else dot++;
    }
  }
  return dot > comma ? '.' : ',';
}

// ---------------------------------------------------------------------------------------------
// Finding the columns
// ---------------------------------------------------------------------------------------------

/** Lower case, accents dropped, punctuation to spaces. */
export function normalizeHeader(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Column names banks use, in Portuguese, English, Spanish, French and German. Earlier names win a tie,
// so the booking date beats the value date.
const HEADER_NAMES: Record<Exclude<StatementColumnField, 'direction'>, string[]> = {
  amount: ['montante', 'amount', 'importe', 'valor', 'betrag', 'montant', 'quantia', 'transaction amount', 'valor eur', 'montante eur', 'importe eur', 'amount eur', 'total amount', 'value'],
  balance: ['saldo', 'balance', 'saldo contabilistico', 'saldo disponivel', 'saldo apos movimento', 'running balance', 'kontostand', 'solde', 'balance eur'],
  credit: ['credito', 'credit', 'abono', 'abonos', 'money in', 'paid in', 'entradas', 'entrada', 'haben', 'credit amount', 'creditos', 'ingresos', 'receitas'],
  currency: ['moeda', 'currency', 'divisa', 'wahrung', 'waehrung', 'devise', 'ccy', 'moneda'],
  date: ['data movimento', 'data mov', 'data de movimento', 'data lancamento', 'data operacao', 'data da operacao', 'booking date', 'transaction date', 'date', 'data', 'fecha', 'fecha operacion', 'datum', 'buchungstag', 'started date', 'completed date', 'posting date', 'date operation', 'data valor', 'value date', 'fecha valor', 'valuta'],
  debit: ['debito', 'debit', 'cargo', 'cargos', 'money out', 'paid out', 'saidas', 'saida', 'soll', 'debit amount', 'debitos', 'gastos', 'despesas'],
  description: ['descricao', 'description', 'descripcion', 'descritivo', 'movimento', 'concepto', 'details', 'detalhes', 'narrative', 'memo', 'payee', 'beneficiary', 'libelle', 'verwendungszweck', 'buchungstext', 'merchant', 'designacao', 'observacoes', 'texto', 'name', 'transaction', 'counterparty'],
  // Only names for the bank's own line id: a payment reference ("Salary", an MB reference) repeats from month to month.
  reference: ['transaction id', 'id', 'n operacao', 'numero operacao', 'numero de operacao', 'referencia operacao', 'id transacao', 'id operacion'],
};

const KIND_REQUIRED: Partial<Record<StatementColumnField, 'date' | 'number'>> = { amount: 'number', balance: 'number', credit: 'number', date: 'date', debit: 'number' };

function headerScore(header: string, field: Exclude<StatementColumnField, 'direction'>) {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;
  const names = HEADER_NAMES[field];
  const exact = names.indexOf(normalized);
  if (exact >= 0) return 100 - exact;
  const words = ` ${normalized} `;
  const partial = names.findIndex((name) => name.length > 2 && words.includes(` ${name} `));
  return partial >= 0 ? 50 - partial : 0;
}

/** The row of column names: the one in the first rows whose cells most look like statement headers. */
export function findHeaderRow(grid: StatementGrid): number {
  let best = { index: -1, score: 0 };
  for (let index = 0; index < Math.min(HEADER_SCAN_ROWS, grid.length); index++) {
    const row = grid[index]!;
    if (row.some((cell) => isDateLike(cell) || isNumberLike(cell))) continue;
    const fields = new Set<string>();
    for (const cell of row) {
      for (const field of Object.keys(HEADER_NAMES) as (keyof typeof HEADER_NAMES)[]) if (headerScore(cell, field) > 0) fields.add(field);
    }
    if (fields.size > best.score) best = { index, score: fields.size };
  }
  if (best.score >= 2) return best.index;

  // No recognisable names: the text-only row just above the first transaction-looking row.
  const firstData = grid.findIndex((row) => row.some(isDateLike) && row.some((cell) => !isDateLike(cell) && isNumberLike(cell)));
  if (firstData > 0 && grid[firstData - 1]!.filter((cell) => cell !== '').length >= 2 && !grid[firstData - 1]!.some(isNumberLike)) return firstData - 1;
  return -1;
}

export function profileColumns(grid: StatementGrid, headerRowIndex: number): StatementColumnProfile[] {
  const rows = dataRows(grid, headerRowIndex).slice(0, DATA_SCAN_ROWS);
  return statementHeaders(grid, headerRowIndex).map((header, index) => {
    const values = rows.map((row) => row[index] ?? '');
    const filled = values.filter((value) => value !== '');
    const share = (predicate: (value: string) => boolean) => (filled.length ? filled.filter(predicate).length / filled.length : 0);
    const distinct = [...new Set(filled)];
    const profile: StatementColumnProfile = {
      dateShare: round(share(isDateLike)),
      emptyShare: round(values.length ? 1 - filled.length / values.length : 1),
      header,
      index,
      negativeShare: round(share((value) => isNumberLike(value) && /^\s*-|-\s*$|^\(/.test(stripCurrency(value)))),
      numberShare: round(share((value) => !isDateLike(value) && isNumberLike(value))),
    };
    if (distinct.length > 0 && distinct.length <= 4 && filled.length >= 4 && distinct.every((value) => value.length <= 12 && !isNumberLike(value) && !isDateLike(value))) profile.distinctValues = distinct;
    return profile;
  });
}

export function statementHeaders(grid: StatementGrid, headerRowIndex: number): string[] {
  const width = Math.max(0, ...grid.slice(Math.max(0, headerRowIndex), Math.max(0, headerRowIndex) + DATA_SCAN_ROWS).map((row) => row.length));
  const names = headerRowIndex >= 0 ? grid[headerRowIndex] ?? [] : [];
  return Array.from({ length: width }, (_, index) => names[index]?.trim() || `Column ${index + 1}`);
}

function dataRows(grid: StatementGrid, headerRowIndex: number) {
  return grid.slice(headerRowIndex + 1).filter((row) => row.some((cell) => cell !== ''));
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Columns their names did not settle, judged by their values alone: the first column of dates, a lone
 * column of numbers (two could be the amount and the balance, which only the names or the model can
 * tell apart), and the longest text column as the description.
 */
function fillColumnsByValues(grid: StatementGrid, headerRowIndex: number, profiles: StatementColumnProfile[], columns: Partial<StatementColumns>, taken: Set<number>) {
  if (columns.date === undefined) {
    const dates = profiles.find((profile) => !taken.has(profile.index) && profile.dateShare >= 0.9);
    if (dates) { columns.date = dates.index; taken.add(dates.index); }
  }
  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) {
    const numbers = profiles.filter((profile) => !taken.has(profile.index) && profile.numberShare >= 0.9 && profile.emptyShare < 0.1);
    if (numbers.length === 1) { columns.amount = numbers[0]!.index; taken.add(numbers[0]!.index); }
    if (numbers.length === 2) {
      const pair = runningBalancePair(dataRows(grid, headerRowIndex), numbers[0]!.index, numbers[1]!.index);
      if (pair) { columns.amount = pair.amount; columns.balance = pair.balance; taken.add(pair.amount); taken.add(pair.balance); }
    }
  }
  if (columns.description === undefined) {
    const rows = dataRows(grid, headerRowIndex).slice(0, DATA_SCAN_ROWS);
    const candidates = profiles.filter((profile) => !taken.has(profile.index) && fitsKind(profile, 'description') && profile.emptyShare < 0.5 && !profile.distinctValues);
    const averageLength = (index: number) => rows.reduce((sum, row) => sum + (row[index]?.length ?? 0), 0) / Math.max(1, rows.length);
    const longest = candidates.sort((a, b) => averageLength(b.index) - averageLength(a.index))[0];
    if (longest) { columns.description = longest.index; taken.add(longest.index); }
  }
}

/**
 * Of two number columns, which is the amount and which the running balance: the balance moves by the
 * amount from one row to the next (in date order, or newest first). Undefined when neither does.
 */
function fitsKind(profile: StatementColumnProfile, field: StatementColumnField) {
  const kind = KIND_REQUIRED[field];
  if (kind === 'date') return profile.dateShare >= 0.6;
  if (kind === 'number') return profile.numberShare >= 0.6 || (field !== 'amount' && profile.emptyShare > 0.2 && profile.numberShare >= 0.5);
  if (field === 'description') return profile.numberShare < 0.5 && profile.dateShare < 0.5;
  // A reference, currency or debit/credit marker is never the column of dates.
  return profile.dateShare < 0.6;
}

function runningBalancePair(rows: StatementGrid, first: number, second: number): undefined | { amount: number; balance: number } {
  const decimalSeparator = inferDecimalSeparator(rows.flatMap((row) => [row[first] ?? '', row[second] ?? '']));
  const read = (index: number) => rows.map((row) => parseStatementAmount(row[index] ?? '', decimalSeparator));
  const matches = (amounts: (number | undefined)[], balances: (number | undefined)[]) => {
    let hits = 0;
    for (let i = 1; i < rows.length; i++) {
      const [amount, previousAmount, balance, previous] = [amounts[i], amounts[i - 1], balances[i], balances[i - 1]];
      if (amount === undefined || previousAmount === undefined || balance === undefined || previous === undefined) continue;
      if (Math.abs(balance - previous - amount) < 0.005 || Math.abs(previous - balance - previousAmount) < 0.005) hits++;
    }
    return rows.length > 1 && hits / (rows.length - 1) >= 0.6;
  };
  const [a, b] = [read(first), read(second)];
  if (matches(a, b)) return { amount: first, balance: second };
  if (matches(b, a)) return { amount: second, balance: first };
  return undefined;
}

const DIRECTION_OUT = new Set(['-', 'cargo', 'd', 'deb', 'debit', 'debito', 'dr', 'out', 'saida']);
const DIRECTION_IN = new Set(['+', 'abono', 'c', 'cr', 'cred', 'credit', 'credito', 'entrada', 'in']);

function directionOf(value: string): -1 | 1 | undefined {
  const normalized = value.trim() === '-' || value.trim() === '+' ? value.trim() : normalizeHeader(value);
  if (DIRECTION_OUT.has(normalized)) return -1;
  if (DIRECTION_IN.has(normalized)) return 1;
  return undefined;
}

/**
 * Columns found by their names, checked against what their values look like, with the formats read
 * from the values. Undefined fields are the ones the names did not settle; `isMappingComplete` says
 * whether the rest is enough to import.
 */
/**
 * A guess (the model's) checked against what the values show: a field whose column holds the wrong
 * kind of value is dropped, a column claimed twice keeps its first field, a single amount column
 * wins over debit and credit, and what is left missing is taken from `fallback`.
 */
export function isMappingComplete(columns: Partial<StatementColumns>): columns is StatementColumns {
  return columns.date !== undefined && columns.description !== undefined && (columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined);
}

export function reconcileColumns(grid: StatementGrid, headerRowIndex: number, guess: Partial<StatementColumns>, fallback: Partial<StatementColumns>): Partial<StatementColumns> {
  const profiles = profileColumns(grid, headerRowIndex);
  const order: StatementColumnField[] = ['date', 'amount', 'debit', 'credit', 'description', 'balance', 'currency', 'direction', 'reference'];
  const taken = new Set<number>();
  const columns: Partial<StatementColumns> = {};
  const place = (field: StatementColumnField, index: number | undefined) => {
    const profile = index === undefined ? undefined : profiles[index];
    if (!profile || taken.has(profile.index) || !fitsKind(profile, field)) return;
    columns[field] = profile.index;
    taken.add(profile.index);
  };
  for (const field of order) place(field, guess[field]);
  if (columns.amount !== undefined) { delete columns.debit; delete columns.credit; }
  // Money in alone, or money out alone, holding both signs is the signed amount.
  const lone = columns.debit === undefined ? columns.credit : columns.credit === undefined ? columns.debit : undefined;
  if (columns.amount === undefined && lone !== undefined && (profiles[lone]?.negativeShare ?? 0) > 0) {
    delete columns.debit;
    delete columns.credit;
    columns.amount = lone;
  }
  // The guess's money columns stand together; only when it named none are the fallback's taken.
  const guessedMoney = columns.amount !== undefined || columns.debit !== undefined || columns.credit !== undefined;
  for (const field of order) {
    const isMoney = field === 'amount' || field === 'debit' || field === 'credit';
    if (columns[field] === undefined && !(isMoney && guessedMoney)) place(field, fallback[field]);
  }
  fillColumnsByValues(grid, headerRowIndex, profiles, columns, taken);
  return columns;
}

export function suggestColumnsByName(grid: StatementGrid, headerRowIndex: number): Partial<StatementColumns> {
  const profiles = profileColumns(grid, headerRowIndex);
  const taken = new Set<number>();
  const columns: Partial<StatementColumns> = {};
  const fields: (keyof typeof HEADER_NAMES)[] = ['date', 'debit', 'credit', 'amount', 'balance', 'currency', 'reference', 'description'];
  for (const field of fields) {
    let best: undefined | { index: number; score: number };
    for (const profile of profiles) {
      if (taken.has(profile.index) || !fitsKind(profile, field)) continue;
      const score = headerScore(profile.header, field);
      if (score > 0 && (!best || score > best.score)) best = { index: profile.index, score };
    }
    if (best) { columns[field] = best.index; taken.add(best.index); }
  }
  if (columns.amount !== undefined && (columns.debit !== undefined || columns.credit !== undefined)) {
    // "Valor" beside "Débito"/"Crédito" is usually the balance or a value date; the split columns are the money.
    delete columns.amount;
  }
  fillColumnsByValues(grid, headerRowIndex, profiles, columns, taken);
  const direction = profiles.find((profile) => !taken.has(profile.index) && profile.distinctValues?.every((value) => directionOf(value) !== undefined));
  if (direction && columns.amount !== undefined) columns.direction = direction.index;
  return columns;
}

/** Date format and decimal separator read from the values of the mapped columns. */
export function inferFormats(grid: StatementGrid, headerRowIndex: number, columns: Partial<StatementColumns>) {
  const rows = dataRows(grid, headerRowIndex);
  const values = (index: number | undefined) => (index === undefined ? [] : rows.map((row) => row[index] ?? '').filter((value) => value !== ''));
  const dates = inferDateFormat(values(columns.date));
  const amounts = [...values(columns.amount), ...values(columns.debit), ...values(columns.credit), ...values(columns.balance)];
  return { ambiguousDateFormat: dates.ambiguous, dateFormat: dates.format, decimalSeparator: inferDecimalSeparator(amounts) };
}

// ---------------------------------------------------------------------------------------------
// Applying a mapping
// ---------------------------------------------------------------------------------------------

/**
 * The file's transactions under `mapping`. A row with neither a date nor an amount is not a
 * transaction (a blank line, a subtotal, a footer) and is passed over; a row with one but not the
 * other is reported as invalid, except past the last transaction, where it is the footer.
 */
export function applyStatementMapping(grid: StatementGrid, mapping: StatementMapping): AppliedStatement {
  const { columns } = mapping;
  const rows: StatementRow[] = [];
  const invalid: { reason: string; row: number }[] = [];
  // The reference identifies a line only when every transaction has one and no two share it.
  const references = columns.reference === undefined ? undefined : grid.slice(mapping.headerRowIndex + 1).filter((row) => row.some((cell) => cell !== '') && parseStatementDate(row[columns.date] ?? '', mapping.dateFormat)).map((row) => row[columns.reference!] ?? '');
  const referencesUnique = references !== undefined && references.length > 0 && references.every(Boolean) && new Set(references).size === references.length;
  const occurrences = new Map<string, number>();

  for (let index = mapping.headerRowIndex + 1; index < grid.length; index++) {
    const cells = grid[index]!;
    if (cells.every((cell) => cell === '')) continue;
    const cell = (column: number | undefined) => (column === undefined ? '' : cells[column] ?? '');
    const date = parseStatementDate(cell(columns.date), mapping.dateFormat);
    const amount = readAmount(cell, mapping);
    const sourceRow = index + 1;
    if (!date && amount === undefined) continue;
    if (!date || amount === undefined) {
      invalid.push({ reason: !date ? 'Unreadable date' : 'Unreadable amount', row: sourceRow });
      continue;
    }
    const description = cell(columns.description).replace(/\s+/g, ' ').trim() || (amount < 0 ? 'Payment' : 'Deposit');
    const currencyCell = cell(columns.currency).toUpperCase();
    const reference = referencesUnique ? cell(columns.reference) : '';
    const fingerprint = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    rows.push({
      amount,
      currency: /^[A-Z]{3}$/.test(currencyCell) ? currencyCell : undefined,
      date,
      description: description.slice(0, 500),
      internalTransactionId: reference ? `ref:${reference.slice(0, 200)}` : `stmt:${createHash('sha256').update(`${fingerprint}|${occurrence}`).digest('base64url').slice(0, 32)}`,
      sourceRow,
    });
  }

  // Unreadable rows after the last transaction are the statement's footer, not failures.
  const lastRow = rows.at(-1)?.sourceRow ?? 0;
  return { invalid: invalid.filter((entry) => entry.row < lastRow), rows };
}

function readAmount(cell: (column: number | undefined) => string, mapping: StatementMapping): number | undefined {
  const { columns, decimalSeparator, invertAmounts } = mapping;
  let amount: number | undefined;
  if (columns.amount !== undefined) {
    amount = parseStatementAmount(cell(columns.amount), decimalSeparator);
    const direction = columns.direction === undefined ? undefined : directionOf(cell(columns.direction));
    if (amount !== undefined && direction !== undefined) amount = Math.abs(amount) * direction;
  } else {
    const debit = parseStatementAmount(cell(columns.debit), decimalSeparator);
    const credit = parseStatementAmount(cell(columns.credit), decimalSeparator);
    if (debit === undefined && credit === undefined) return undefined;
    amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
  }
  if (amount === undefined) return undefined;
  const signed = invertAmounts ? -amount : amount;
  return Object.is(signed, -0) ? 0 : Math.round(signed * 100) / 100;
}

/** The first rows as one letter per cell (D date, N number, T text, _ empty): their shape without their content. */
export function statementRowShapes(grid: StatementGrid, count = 15): string[] {
  return grid.slice(0, count).map((row) => row.map((cell) => (cell === '' ? '_' : isDateLike(cell) ? 'D' : isNumberLike(cell) ? 'N' : 'T')).join(''));
}
