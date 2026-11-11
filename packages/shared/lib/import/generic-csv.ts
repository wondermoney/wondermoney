import { parse } from 'csv-parse/sync';

import { signTransactionAmount } from './direction';
import type { ImportAdapter, ImportParseResult, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * The older WonderMoney CSV template, for the staged import session.
 *
 * Its columns are fixed: `date`, `amount`, `merchant`, `internalTransactionId`,
 * `transactionTypeKey`, and optionally `description` and `currencyKey`. The type is a number naming
 * a row of `transaction_type`, so the type decides the direction (a payment's amount is a
 * magnitude, however the file signs it) exactly as a manual entry does; a type with no direction
 * (EXCHANGE, REVERT) keeps the file's sign. `internalTransactionId` is the line's own id, so a
 * re-import finds it; `currencyKey` names a row of `currency`, and a row without it is in the
 * target account's currency.
 *
 * The adapter is pure, so the numbers in the file are resolved by the caller: `transactionTypes`
 * and `currencies` map them to the names and codes the session stores.
 */

export const GENERIC_CSV_REQUIRED_COLUMNS = ['date', 'amount', 'merchant', 'internalTransactionId', 'transactionTypeKey'] as const;

export interface GenericCsvAdapterOptions {
  /** The currency of a row whose `currencyKey` is empty: the target account's. */
  accountCurrency?: string;
  /** The instance's currencies by numeric key, for the optional `currencyKey` column. */
  currencies?: Record<string, string>;
  /** The instance's transaction types by numeric key, for the required `transactionTypeKey` column. */
  transactionTypes?: Record<string, string>;
}

/** The file is not the generic CSV template at all (its columns are missing or it cannot be parsed). */
export class GenericCsvUnreadableError extends Error {
  constructor(readonly code: 'columns_not_found' | 'unreadable' = 'unreadable') {
    super(code === 'columns_not_found' ? 'Could not work out the columns of this CSV template' : 'Could not read the CSV template');
    this.name = 'GenericCsvUnreadableError';
  }
}

/**
 * Whether the bytes look like the generic CSV template: its header names `internalTransactionId`
 * and `transactionTypeKey`, which no bank export does. The file, not the account, decides.
 */
export function isGenericCsvTemplate(input: Uint8Array): boolean {
  const head = new TextDecoder('utf-8').decode(input.subarray(0, 4096)).replace(/^\uFEFF/, '');
  const header = head.split(/\r?\n/, 1)[0] ?? '';
  return header.includes('internalTransactionId') && header.includes('transactionTypeKey');
}

interface TemplateRecord {
  info: { lines: number };
  record: Record<string, string>;
}

export const genericCsvImportAdapter: ImportAdapter<GenericCsvAdapterOptions> = {
  format: 'generic-csv',
  async parse(input, options) {
    const text = new TextDecoder('utf-8').decode(input);
    let headers: string[] = [];
    let records: TemplateRecord[];
    try {
      records = parse(text, {
        columns: (header: string[]) => {
          headers = header;
          return header;
        },
        info: true,
        skip_empty_lines: true,
        trim: true,
      }) as TemplateRecord[];
    } catch {
      throw new GenericCsvUnreadableError('unreadable');
    }
    const missing = GENERIC_CSV_REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length > 0) throw new GenericCsvUnreadableError('columns_not_found');
    return { rows: records.map((record) => rowFor(record, options)), sourceAccounts: [], warnings: [] } satisfies ImportParseResult;
  },
};

function rowFor({ info, record }: TemplateRecord, options: GenericCsvAdapterOptions): ParsedImportRow {
  const raw = {
    amount: record['amount'] ?? '',
    currencyKey: record['currencyKey'] ?? '',
    date: record['date'] ?? '',
    description: record['description'] ?? '',
    internalTransactionId: record['internalTransactionId'] ?? '',
    merchant: record['merchant'] ?? '',
    transactionTypeKey: record['transactionTypeKey'] ?? '',
  };
  const sourceRow = info.lines;
  const missing = GENERIC_CSV_REQUIRED_COLUMNS.filter((column) => !text(record[column]));
  if (missing.length > 0) return { error: `Missing ${missing.join(', ')}`, raw, sourceRow };

  const date = parseDate(record['date']!);
  if (!date) return { error: 'Unreadable date', raw, sourceRow };
  const amount = parseAmount(record['amount']!);
  if (amount === undefined) return { error: 'Unreadable amount', raw, sourceRow };
  const typeKey = positiveInt(record['transactionTypeKey']!);
  if (typeKey === undefined) return { error: 'Invalid transaction type', raw, sourceRow };
  const typeName = options.transactionTypes?.[String(typeKey)];
  if (!typeName) return { error: `Unknown transaction type: ${typeKey}`, raw, sourceRow };
  const currency = currencyOf(record['currencyKey'], options);
  if (currency === 'unknown') return { error: `Unknown currency: ${record['currencyKey']}`, raw, sourceRow };

  const merchant = text(record['merchant'])!.slice(0, 255);
  const description = text(record['description'])?.slice(0, 500) ?? '';
  const normalized: NormalizedImportRow = {
    // The type is the file's word, so it decides the sign; a type with no direction keeps it.
    amount: signTransactionAmount(amount, typeName),
    date: date.toISOString(),
    description,
    externalId: text(record['internalTransactionId'])!.slice(0, 255),
    merchant,
    typeHint: typeName,
    typeIsUserSet: true,
    ...(currency !== undefined ? { currency } : {}),
  };
  return { normalized, raw, sourceRow };
}

/** The row's currency code, `undefined` when it names none, or `'unknown'` when the key is not one. */
function currencyOf(value: string | undefined, options: GenericCsvAdapterOptions): 'unknown' | string | undefined {
  const key = text(value);
  if (key === undefined) return undefined;
  const currencyKey = positiveInt(key);
  const code = currencyKey === undefined ? undefined : options.currencies?.[String(currencyKey)];
  return code ?? 'unknown';
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The same date reading as the one-step import: what `new Date(value)` makes of the cell. */
function parseDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseAmount(value: string): number | undefined {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}

/** A positive integer as the template writes it: decimal digits, no sign, no fraction. */
function positiveInt(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
