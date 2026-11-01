import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionAuditActorType } from '@entity/TransactionAuditLog';
import { TransactionType } from '@entity/TransactionType';
import { reconcileTransfers } from '@service/transaction/transfer-matching.service';
import { reportFiltersSchema } from '@validators/reports';

// The spreadsheet decoding is the only part replaced: each test hands the real bank parser the
// rows a bank export decodes to, so the parser, the description guess and the import all run.
const { parseExcelMock } = vi.hoisted(() => ({ parseExcelMock: vi.fn() }));
vi.mock('@wondermoney/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wondermoney/shared')>();
  return { ...actual, csv: { ...actual.csv, parseExcel: parseExcelMock } };
});
// Job enqueues after the import; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import AccountCsvImportService from '@service/account/account-csv-import.service';
import { getCashflowReport } from '@service/reports/cashflow.service';

const TYPE_NAMES = ['CARD_PAYMENT', 'CARD_REFUND', 'DEPOSIT', 'FEE', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
const GENERIC_HEADER = 'date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey';

/** Millennium BCP: 13 header rows, then [date, value date, description, signed amount, Débito/Crédito, balance], then one footer row. */
function bcpSheet(rows: { amount: number; date: Date; description: string }[]) {
  const header = Array.from({ length: 13 }, () => [null]);
  const body = rows.map((row) => [row.date, row.date, row.description, row.amount, row.amount < 0 ? 'Débito' : 'Crédito', 0]);
  return [...header, ...body, [null]];
}

/*
 * An imported statement counts the way a synced one does: money in is income and money out is
 * spending, unless it is one half of a transfer between two of the household's own accounts. Only
 * the generic CSV format has a type column, and a transfer type there is the user's word for it.
 * Reports leave transfers out, so a salary typed as one would show as no income at all.
 */
describe('CSV import: money in is income unless it is an own-account transfer', () => {
  const db = useTestDatabase();
  let household: Household;
  let savings: Account;
  let types: Record<(typeof TYPE_NAMES)[number], TransactionType>;
  let sequence = 0;
  const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12));

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    const created = TYPE_NAMES.map((name) => em.create(TransactionType, { displayName: name, name }, { partial: true }));
    await em.flush();
    types = Object.fromEntries(created.map((type) => [type.name, type])) as typeof types;
    savings = await addAccount(em, household, { name: 'Savings' });
  });

  async function importStatement(account: Account, rows: { amount: number; date: Date; description: string }[]) {
    parseExcelMock.mockResolvedValueOnce(bcpSheet(rows));
    return new AccountCsvImportService().importAccountCsv(
      { accountKey: account.accountKey, bankName: 'bcp', bucket: 'bucket', key: 'statement.xlsx' },
      { em: db.em(), getObjectBuffer: () => Promise.resolve(Buffer.from('xlsx')), getObjectSize: () => Promise.resolve(undefined) },
    );
  }

  async function importGeneric(account: Account, rows: { amount: string; date: Date; type: (typeof TYPE_NAMES)[number] }[]) {
    const body = rows.map((row) => `${row.date.toISOString()},${row.amount},,Merchant,,generic-${++sequence},${types[row.type].transactionTypeKey}`);
    return new AccountCsvImportService().importAccountCsv(
      { accountKey: account.accountKey, bucket: 'bucket', key: 'generic.csv' },
      { em: db.em(), getObjectSize: () => Promise.resolve(undefined), getObjectText: () => Promise.resolve([GENERIC_HEADER, ...body].join('\n')) },
    );
  }

  async function storedTypes(account: Account) {
    const rows = await db.em().find(Transaction, { accountKey: account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionTypeKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, type: row.transactionTypeKey?.name }));
  }

  const cashflow = () => getCashflowReport({ filters: reportFiltersSchema.parse({ fromDate: '2026-09-01T00:00:00Z', toDate: '2026-09-30T23:59:59Z' }), tenant: household.tenant, user: household.appuser });

  describe('bank statement', () => {
    it('counts an imported salary as income', async () => {
      await importStatement(household.account, [
        { amount: 1500, date: day(1), description: 'SALARIO ACME LDA' },
        { amount: -42.5, date: day(2), description: 'COMPRA 1234 SUPERMERCADO' },
      ]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 1500, type: 'DEPOSIT' }, { amount: -42.5, type: 'CARD_PAYMENT' }]);
      expect(await cashflow()).toEqual([expect.objectContaining({ expenses: 42.5, income: 1500 })]);
    });

    it('counts a credit described as a transfer from someone else as income', async () => {
      await importStatement(household.account, [{ amount: 1500, date: day(1), description: 'TRF SEPA DE ACME LDA' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 1500, type: 'DEPOSIT' }]);
      expect(await cashflow()).toEqual([expect.objectContaining({ income: 1500 })]);
    });

    it('counts a debit described as a transfer to someone else as spending', async () => {
      await importStatement(household.account, [{ amount: -700, date: day(1), description: 'TRF P/ SENHORIO' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: -700, type: 'PAYMENT' }]);
      expect(await cashflow()).toEqual([expect.objectContaining({ expenses: 700 })]);
    });

    it('pairs money moved between two household accounts imported from two statements', async () => {
      await importStatement(household.account, [
        { amount: 1500, date: day(1), description: 'SALARIO ACME LDA' },
        { amount: -500, date: day(2), description: 'TRF P/ POUPANCA' },
      ]);
      await importStatement(savings, [{ amount: 500, date: day(3), description: 'TRF SEPA DE CONTA ORDEM' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 1500, type: 'DEPOSIT' }, { amount: -500, type: 'TRANSFER_OUT' }]);
      expect(await storedTypes(savings)).toEqual([{ amount: 500, type: 'TRANSFER_IN' }]);
      expect(await cashflow()).toEqual([expect.objectContaining({ expenses: 0, income: 1500 })]);
    });

    it('pairs an imported credit with a debit synced on another household account', async () => {
      await addTransaction(db.em(), household, { account: savings, amount: -300, date: day(4), enableBankingTransactionId: 'eb-1', status: 'BOOKED', type: types.PAYMENT });

      await importStatement(household.account, [{ amount: 300, date: day(5), description: 'TRF SEPA DE POUPANCA' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 300, type: 'TRANSFER_IN' }]);
      expect(await storedTypes(savings)).toEqual([{ amount: -300, type: 'TRANSFER_OUT' }]);
      expect(await cashflow()).toEqual([]);
    });
  });

  describe('generic CSV', () => {
    it('counts a row typed as a deposit as income', async () => {
      await importGeneric(household.account, [{ amount: '2000', date: day(1), type: 'DEPOSIT' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 2000, type: 'DEPOSIT' }]);
      expect(await cashflow()).toEqual([expect.objectContaining({ income: 2000 })]);
    });

    it('keeps an unpaired row the file types as a transfer in a transfer, through later matching', async () => {
      await importGeneric(household.account, [{ amount: '250', date: day(1), type: 'TRANSFER_IN' }]);
      await reconcileTransfers(db.em(), { actorType: TransactionAuditActorType.SYNC, apply: true, source: 'test', tenantKey: household.tenant.tenantKey });

      expect(await storedTypes(household.account)).toEqual([{ amount: 250, type: 'TRANSFER_IN' }]);
      expect(await cashflow()).toEqual([]);
    });

    it('does not turn a row the file types as a deposit into a transfer', async () => {
      await addTransaction(db.em(), household, { account: savings, amount: -2000, date: day(1), enableBankingTransactionId: 'eb-2', status: 'BOOKED', type: types.PAYMENT });

      await importGeneric(household.account, [{ amount: '2000', date: day(1), type: 'DEPOSIT' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: 2000, type: 'DEPOSIT' }]);
      expect(await storedTypes(savings)).toEqual([{ amount: -2000, type: 'PAYMENT' }]);
    });

    it('pairs a row the file types as a transfer out with the credit synced on another household account', async () => {
      await addTransaction(db.em(), household, { account: savings, amount: 400, date: day(2), enableBankingTransactionId: 'eb-3', status: 'BOOKED', type: types.DEPOSIT });

      await importGeneric(household.account, [{ amount: '400', date: day(1), type: 'TRANSFER_OUT' }]);

      expect(await storedTypes(household.account)).toEqual([{ amount: -400, type: 'TRANSFER_OUT' }]);
      expect(await storedTypes(savings)).toEqual([{ amount: 400, type: 'TRANSFER_IN' }]);
      expect(await cashflow()).toEqual([]);
    });
  });
});
