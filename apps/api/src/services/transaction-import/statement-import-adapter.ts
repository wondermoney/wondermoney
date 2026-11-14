import type { transactionImport } from '@wondermoney/shared';

import { detectStatement, type NativeBankRow } from '@service/account/account-statement-detection.service';
import type { StatementMapping } from '@service/account/account-statement-mapping.schema';
import { type StatementLine, statementLineSchema, statementRowToLine } from '@service/account/account-statement-transaction';

/**
 * The `statement` format: a bank statement export (CSV in any delimiter or encoding, XLS, XLSX),
 * read the way the one-step import reads it (`detectStatement`): the bank's own parser for an
 * account at a supported bank, else the columns the person confirmed in the preview, else the
 * columns found by name. A statement is for the one account the import was started on, so it
 * names no source accounts.
 *
 * It lives in the API rather than `packages/shared/lib/import/` because the statement reader does
 * (`account-statement-reader.ts`); it is pure all the same, and moves there with the reader.
 */
export interface StatementAdapterOptions {
  /** The currency of a line that names none: the account's. */
  accountCurrency: string;
  /** The account's bank, when it has its own parser. */
  bankName?: string;
  /** The columns the person confirmed in the preview. */
  mapping?: StatementMapping;
}

/** The file could not be read as a statement at all (no columns found, an unreadable file). */
export class StatementUnreadableError extends Error {
  constructor(readonly code: 'columns_not_found' | 'unreadable') {
    super(code === 'columns_not_found' ? 'Could not work out the columns of this file' : 'Could not read the file');
  }
}

export const statementImportAdapter: transactionImport.ImportAdapter<StatementAdapterOptions> = {
  format: 'statement',
  async parse(input, options) {
    let detection: Awaited<ReturnType<typeof detectStatement>>;
    try {
      detection = await detectStatement({ bankName: options.bankName, buffer: Buffer.from(input), mapping: options.mapping });
    } catch {
      throw new StatementUnreadableError('unreadable');
    }
    if (detection.bankRows) {
      return { rows: detection.bankRows.map((row, index) => fromLine(bankLine(row), index + 1)), sourceAccounts: [], warnings: [] };
    }
    if (!detection.applied) throw new StatementUnreadableError('columns_not_found');
    const rows = [
      ...detection.applied.rows.map((row) => fromLine(statementRowToLine(row, options.accountCurrency), row.sourceRow)),
      ...detection.applied.invalid.map((row): transactionImport.ParsedImportRow => ({ error: row.reason, raw: {}, sourceRow: row.row })),
    ].sort((a, b) => a.sourceRow - b.sourceRow);
    return { rows, sourceAccounts: [], warnings: [] };
  },
};

/** A bank parser's row as a statement line; the parsers also carry the charged amount and currency. */
function bankLine(row: NativeBankRow): StatementLine {
  return row;
}

/**
 * One line, checked the way the commit writes it, so a line that cannot be written shows as
 * unreadable in the review rather than failing at commit.
 */
function fromLine(line: StatementLine, sourceRow: number): transactionImport.ParsedImportRow {
  const raw = { amount: String(line.settlementAmount), date: line.transactionDate instanceof Date && !Number.isNaN(line.transactionDate.getTime()) ? line.transactionDate.toISOString() : String(line.transactionDate), description: line.descriptionDirty ?? line.transactionMerchant };
  const parsed = statementLineSchema.safeParse(line);
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 500), raw, sourceRow };
  const value = parsed.data;
  const originalAmount = line.originalAmount === undefined ? undefined : Number(line.originalAmount.toString());
  return {
    normalized: {
      amount: value.settlementAmount,
      currency: value.settlementCurrency,
      date: value.transactionDate.toISOString(),
      description: value.descriptionDirty ?? '',
      externalId: value.internalTransactionId,
      merchant: value.transactionMerchant,
      ...(originalAmount !== undefined && Number.isFinite(originalAmount) ? { originalAmount } : {}),
      ...(line.originalCurrency ? { originalCurrency: line.originalCurrency } : {}),
      typeHint: value.transactionType,
    },
    raw,
    sourceRow,
  };
}

/** A staged row back as the statement line the writer takes. */
export function toStatementLine(row: transactionImport.NormalizedImportRow, sourceRow: number, accountCurrency: string): StatementLine {
  return {
    descriptionDirty: row.description === '' ? undefined : row.description,
    internalTransactionId: row.externalId,
    ...(row.notes ? { notes: row.notes.slice(0, 255) } : {}),
    ...(row.originalAmount !== undefined ? { originalAmount: row.originalAmount } : {}),
    ...(row.originalCurrency ? { originalCurrency: row.originalCurrency } : {}),
    settlementAmount: row.amount,
    settlementCurrency: row.currency ?? accountCurrency,
    sourceRow,
    transactionDate: new Date(row.date),
    transactionMerchant: row.merchant ?? row.description.slice(0, 255),
    transactionType: row.typeHint ?? (row.amount < 0 ? 'PAYMENT' : 'DEPOSIT'),
  };
}
