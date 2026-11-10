import { csv } from '@wondermoney/shared';

import logger from '@utils/logger';

import { requestStatementMapping } from './account-statement-mapping-openai';
import type { StatementColumns, StatementMapping } from './account-statement-mapping.schema';
import { type AppliedStatement, applyStatementMapping, findHeaderRow, inferFormats, isMappingComplete, profileColumns, readStatementGrid, reconcileColumns, type StatementGrid, statementHeaders, statementRowShapes, suggestColumnsByName } from './account-statement-reader';

/**
 * Works out how to read a statement file, cheapest first:
 *
 *   the person's own mapping (a correction from the preview)
 *   → the account's bank parser, when the file is that bank's export
 *   → the column names
 *   → the model, when allowed and the household has allowance left
 *   → nothing: the preview asks the person to pick the columns
 *
 * The preview endpoint and the import worker both call this, so what the person confirmed is what
 * gets imported.
 */

export interface DetectStatementInput {
  bankName?: string;
  buffer: Buffer;
  mapping?: StatementMapping;
  /** Absent: column names only, no model call. */
  model?: { allowed: boolean; spend: () => Promise<boolean> };
}

export interface NativeBankRow {
  descriptionDirty?: string;
  internalTransactionId: string;
  settlementAmount: number | string | { toString: () => string };
  settlementCurrency: string;
  transactionDate: Date;
  transactionMerchant: string;
  transactionType: string;
}

export interface StatementDetection {
  ambiguousDateFormat: boolean;
  /** The file's transactions under `mapping`; absent when the bank parser read it. */
  applied?: AppliedStatement;
  bankName?: string;
  bankRows?: NativeBankRow[];
  headers: string[];
  /** Incomplete (missing columns) when `source` is `none`. */
  mapping?: Omit<StatementMapping, 'columns'> & { columns: Partial<StatementColumns> };
  source: StatementSource;
}

export type StatementSource = 'bank' | 'columns' | 'model' | 'none' | 'person';

/** At least this share of the rows must read cleanly for a guess to be trusted without asking. */
const MIN_VALID_SHARE = 0.8;

export async function detectStatement(input: DetectStatementInput): Promise<StatementDetection> {
  if (input.mapping) {
    const grid = await readStatementGrid(input.buffer);
    return { ambiguousDateFormat: false, applied: applyStatementMapping(grid, input.mapping), headers: statementHeaders(grid, input.mapping.headerRowIndex), mapping: input.mapping, source: 'person' };
  }

  if (input.bankName) {
    const bankRows = await readWithBankParser(input.buffer, input.bankName);
    if (bankRows) return { ambiguousDateFormat: false, bankName: input.bankName, bankRows, headers: [], source: 'bank' };
  }

  const grid = await readStatementGrid(input.buffer);
  const headerRowIndex = findHeaderRow(grid);
  const byName = suggestColumnsByName(grid, headerRowIndex);
  const fromNames = tryMapping(grid, headerRowIndex, byName, false);
  if (fromNames) return { ...fromNames, source: 'columns' };

  if (input.model?.allowed && (await input.model.spend())) {
    try {
      const shapes = statementRowShapes(grid);
      const guess = await requestStatementMapping({ columns: profileColumns(grid, headerRowIndex), rowShapes: shapes });
      // A small model can misplace a column the values already settle; each header row it or the
      // file suggests is tried with its answer checked against the values, and the one reading most rows wins.
      const headerRows = [...new Set([guess.headerRowIndex, headerRowIndex])].filter((index) => index >= -1 && index < grid.length);
      const readings = headerRows.flatMap((index) => {
        const reading = tryMapping(grid, index, reconcileColumns(grid, index, guess.columns, suggestColumnsByName(grid, index)), guess.spendingIsPositive);
        return reading ? [reading] : [];
      });
      const best = readings.sort((a, b) => b.applied.rows.length - a.applied.rows.length)[0];
      if (best) return { ...best, source: 'model' };
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Statement column mapping by model failed');
    }
  }

  const formats = inferFormats(grid, headerRowIndex, byName);
  return {
    ambiguousDateFormat: formats.ambiguousDateFormat,
    headers: statementHeaders(grid, headerRowIndex),
    mapping: { columns: byName, dateFormat: formats.dateFormat, decimalSeparator: formats.decimalSeparator, headerRowIndex, invertAmounts: false },
    source: 'none',
  };
}

function tryMapping(grid: StatementGrid, headerRowIndex: number, columns: Partial<StatementColumns>, invertAmounts: boolean) {
  if (!isMappingComplete(columns)) return undefined;
  const { ambiguousDateFormat, dateFormat, decimalSeparator } = inferFormats(grid, headerRowIndex, columns);
  const mapping: StatementMapping = { columns, dateFormat, decimalSeparator, headerRowIndex, invertAmounts };
  const applied = applyStatementMapping(grid, mapping);
  const read = applied.rows.length;
  if (read === 0 || read / (read + applied.invalid.length) < MIN_VALID_SHARE) return undefined;
  return { ambiguousDateFormat, applied, headers: statementHeaders(grid, headerRowIndex), mapping };
}

/** The bank's own parser's rows, when this file is that bank's export and they read cleanly. */
export interface StatementPreview {
  ambiguousDateFormat: boolean;
  bankName?: string;
  firstDate?: string;
  headers: string[];
  invalidRows: number;
  lastDate?: string;
  mapping?: StatementDetection['mapping'];
  sample: { amount: number; currency: string; date: string; description: string }[];
  source: StatementSource;
  totalRows: number;
}

async function readWithBankParser(buffer: Buffer, bankName: string): Promise<NativeBankRow[] | undefined> {
  try {
    const parsed = await csv.parseExcel(buffer);
    const rows = (csv.getBankParser(bankName) as unknown as (data: unknown) => NativeBankRow[])(parsed);
    const valid = rows.filter((row) => row.transactionDate instanceof Date && !Number.isNaN(row.transactionDate.getTime()) && Number.isFinite(Number(row.settlementAmount.toString())));
    return rows.length > 0 && valid.length / rows.length >= MIN_VALID_SHARE ? rows : undefined;
  } catch {
    return undefined;
  }
}

const SAMPLE_SIZE = 5;

/** What the import dialog shows: how the file was read, how many transactions, over which dates, and the first few. */
export function toStatementPreview(detection: StatementDetection, accountCurrency: string): StatementPreview {
  const rows = detection.bankRows
    ? detection.bankRows.map((row) => ({ amount: Number(row.settlementAmount.toString()), currency: row.settlementCurrency, date: row.transactionDate, description: row.transactionMerchant || row.descriptionDirty || '' }))
    : (detection.applied?.rows ?? []).map((row) => ({ amount: row.amount, currency: row.currency ?? accountCurrency, date: row.date, description: row.description }));
  const dates = rows.map((row) => row.date.getTime()).filter(Number.isFinite);
  const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
  return {
    ambiguousDateFormat: detection.ambiguousDateFormat,
    bankName: detection.bankName,
    firstDate: dates.length ? isoDay(Math.min(...dates)) : undefined,
    headers: detection.headers,
    invalidRows: detection.applied?.invalid.length ?? 0,
    lastDate: dates.length ? isoDay(Math.max(...dates)) : undefined,
    mapping: detection.mapping,
    sample: rows.slice(0, SAMPLE_SIZE).map((row) => ({ ...row, date: isoDay(row.date.getTime()) })),
    source: detection.source,
    totalRows: rows.length,
  };
}
