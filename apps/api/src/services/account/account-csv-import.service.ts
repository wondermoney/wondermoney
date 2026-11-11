import { z } from 'zod';

import { DI } from '@app/database/di';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { detectStatement } from '@service/account/account-statement-detection.service';
import type { StatementMapping } from '@service/account/account-statement-mapping.schema';
import { buildStatementTransaction, followUpStatementImport, matchTransfersAfterImport, settleStatementImport, type StatementLine, statementLineSchema, statementRowToLine, statementWriteContext } from '@service/account/account-statement-transaction';
import { getLimitedCsvObjectBuffer, getLimitedCsvObjectText, parseCsvRows } from '@service/account/csv-upload-boundary.service';
import type { Enqueue } from '@service/queue/enqueue';
import { applyRulesToNewTransactions } from '@service/rules/rule-application.service';
import { transactionCreationService } from '@service/transaction/transaction-creation.service';

export interface AccountCsvImportResult { failed: number; failures: { reason: string; row: number; }[]; imported: number; skipped: number; skippedRows: { reason: string; row: number; }[]; totalRows: number; }

interface AccountCsvRow { amount: string; currencyKey?: string; date: string; description?: string; internalTransactionId: string; merchant: string; transactionTypeKey: string; }
type BankCsvRow = StatementLine;

const REQUIRED_FIELDS: (keyof AccountCsvRow)[] = ['date', 'amount', 'merchant', 'internalTransactionId', 'transactionTypeKey'];
const MAX_INVALID_ROWS = 100;

const accountCsvRowSchema = z.object({
  amount: z.coerce.number(),
  currencyKey: z.string().trim().optional().transform((value) => (value ? toPositiveInt(value) : undefined)),
  date: z.string().trim().refine((value) => isValidDate(value), 'Invalid date').transform((value) => new Date(value)),
  description: z.string().trim().max(500).optional(),
  internalTransactionId: z.string().trim().min(1).max(255),
  merchant: z.string().trim().min(1).max(255),
  transactionTypeKey: z.string().trim().transform((value) => toPositiveInt(value)),
}).strict();


export default class AccountCsvImportService {
  async importAccountCsv(input: { accountKey: number; bankName?: string; bucket: string; key: string; mapping?: StatementMapping }, deps: { em?: typeof DI.em; enqueue?: Enqueue; getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>; getObjectText?: (bucket: string, key: string) => Promise<string>; transactionCreationService?: typeof transactionCreationService; } = {}): Promise<AccountCsvImportResult> {
    const em = deps.em ?? DI.em;
    const transactionCreationServiceImpl = deps.transactionCreationService ?? transactionCreationService;
    const account = await em.findOne(Account, { accountKey: input.accountKey, deletedAt: undefined }, { populate: ['accountOwnerAppuserKey.currencyKey', 'currencyKey'] });
    if (!account) throw new Error('Account not found');
    if (input.bankName || input.mapping || !(await this.isGenericTemplate(input, deps))) {
      // Any statement export: the bank's own parser when it is that bank's file, else the columns the
      // person confirmed in the preview, else the columns found by name.
      const buffer = await getLimitedCsvObjectBuffer({ bucket: input.bucket, key: input.key }, { getObjectBuffer: deps.getObjectBuffer, getObjectSize: deps.getObjectSize });
      const detection = await detectStatement({ bankName: input.bankName, buffer, mapping: input.mapping });
      if (detection.bankRows) return this.importBankRows({ account, em, enqueue: deps.enqueue, rows: detection.bankRows });
      if (!detection.applied) throw new Error('Could not work out the columns of this file');
      const currencyCode = (account.currencyKey as undefined | { code?: string })?.code ?? 'EUR';
      return this.importBankRows({ account, em, enqueue: deps.enqueue, invalid: detection.applied.invalid, rows: detection.applied.rows.map((row) => statementRowToLine(row, currencyCode)) });
    }
    const csvText = await getLimitedCsvObjectText({ bucket: input.bucket, key: input.key }, { getObjectSize: deps.getObjectSize, getObjectText: deps.getObjectText });
    const rows = parseCsvRows<AccountCsvRow>(csvText);
    const result: AccountCsvImportResult = { failed: 0, failures: [], imported: 0, skipped: 0, skippedRows: [], totalRows: 0 };
    const importedDates: Date[] = [];
    const importedKeys: number[] = [];
    for (const [i, row] of rows.entries()) {
      result.totalRows += 1;
      const missing = REQUIRED_FIELDS.filter((field) => !row[field]);
      if (missing.length) {
        result.failed += 1;
        result.failures.push({ reason: `missing ${missing.join(', ')}`, row: i + 2 });
        if (result.failed >= MAX_INVALID_ROWS) break;
        continue;
      }
      try {
        const validated = accountCsvRowSchema.parse(row);
        const duplicate = await em.findOne(Transaction, { accountKey: account, nordigenInternalTransactionId: validated.internalTransactionId });
        if (duplicate) { result.skipped += 1; result.skippedRows.push({ reason: 'Duplicate internalTransactionId', row: i + 2 }); continue; }
        // The file's amount goes through signed: the creation service lets a directional type decide
        // the sign (`signTransactionAmount`), and keeps this sign for EXCHANGE and REVERT, which have none.
        const created = await transactionCreationServiceImpl.createTransaction({ accountId: account.accountKey, appuserKey: (account.accountOwnerAppuserKey as { appuserKey: number }).appuserKey, deferRules: true, description: validated.description, nordigenInternalTransactionId: validated.internalTransactionId, settlementAmount: validated.amount, settlementCurrencyId: validated.currencyKey || (account.currencyKey as { currencyKey: number }).currencyKey, transactionDate: validated.date, transactionMerchantName: validated.merchant, transactionTypeId: validated.transactionTypeKey });
        result.imported += 1;
        importedDates.push(validated.date);
        importedKeys.push(created.transactionKey);
      } catch (error) { result.failed += 1; result.failures.push({ reason: error instanceof Error ? error.message : 'import failed', row: i + 2 }); if (result.failed >= MAX_INVALID_ROWS) break; }
    }
    // The household's rules, once for every row this import created.
    const tenantKey = (account as { tenantKey?: { tenantKey: number } }).tenantKey?.tenantKey;
    if (tenantKey !== undefined) await applyRulesToNewTransactions(em, tenantKey, importedKeys, 'transaction-import');
    await matchTransfersAfterImport(em, account, importedDates);
    return result;
  }

  /** Whether the file is the generic CSV template (`internalTransactionId` and `transactionTypeKey` columns), read by the older path. */
  private async importBankRows(input: { account: Account; em: typeof DI.em; enqueue?: Enqueue; invalid?: { reason: string; row: number }[]; rows: BankCsvRow[] }): Promise<AccountCsvImportResult> {
    const { rows } = input;
    const invalid = input.invalid ?? [];
    const result: AccountCsvImportResult = { failed: invalid.length, failures: [...invalid], imported: 0, skipped: 0, skippedRows: [], totalRows: invalid.length };
    const importedTransactions: Transaction[] = [];
    const runInTransaction = async (em: typeof input.em) => {
      const context = await statementWriteContext(em, input.account);
      for (const [i, row] of rows.entries()) {
        result.totalRows += 1;
        try {
          const validated = statementLineSchema.parse(row);
          const duplicate = await em.findOne(Transaction, { $or: [{ internalTransactionId: validated.internalTransactionId }, { nordigenInternalTransactionId: validated.internalTransactionId }], accountKey: input.account });
          if (duplicate) { result.skipped += 1; result.skippedRows.push({ reason: 'Duplicate internalTransactionId', row: row.sourceRow ?? i + 1 }); continue; }
          importedTransactions.push(await buildStatementTransaction(em, context, row));
          result.imported += 1;
        } catch (error) { result.failed += 1; result.failures.push({ reason: error instanceof Error ? error.message : 'import failed', row: row.sourceRow ?? i + 1 }); if (result.failed >= MAX_INVALID_ROWS) break; }
      }
      const existingTransactions = await em.find(Transaction, { accountKey: input.account, deletedAt: undefined });
      await settleStatementImport(em, input.account, existingTransactions, importedTransactions);
    };
    const transactional = Reflect.get(input.em, 'transactional') as unknown;
    // Called on the EntityManager: `transactional` reads its own context, so a detached call throws.
    if (typeof transactional === 'function') await (transactional as (fn: typeof runInTransaction) => Promise<void>).call(input.em, runInTransaction); else await runInTransaction(input.em);
    await followUpStatementImport(input.em, input.account, importedTransactions.flatMap((transaction) => (transaction.transactionDate ? [transaction.transactionDate] : [])), { enqueue: input.enqueue, transactions: importedTransactions });
    return result;
  }

  private async isGenericTemplate(input: { bucket: string; key: string }, deps: { getObjectBuffer?: (bucket: string, key: string) => Promise<Buffer>; getObjectSize?: (bucket: string, key: string) => Promise<number | undefined>; getObjectText?: (bucket: string, key: string) => Promise<string> }) {
    const buffer = await getLimitedCsvObjectBuffer({ bucket: input.bucket, key: input.key }, { getObjectBuffer: deps.getObjectBuffer, getObjectSize: deps.getObjectSize });
    const header = buffer.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    return header.includes('internalTransactionId') && header.includes('transactionTypeKey');
  }
}

function isValidDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}


function toPositiveInt(value: string) {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new Error('Invalid positive integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error('Invalid positive integer');
  return parsed;
}
