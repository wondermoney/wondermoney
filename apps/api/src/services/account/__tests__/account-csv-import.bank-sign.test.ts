import { generateInternalTransactionId } from '@wondermoney/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

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

const TYPE_NAMES = ['ATM', 'CARD_PAYMENT', 'CARD_REFUND', 'CASHBACK', 'DEPOSIT', 'EXCHANGE', 'FEE', 'LOAN', 'PAYMENT', 'REVERT', 'REWARD', 'TOPUP', 'TRANSFER_IN', 'TRANSFER_OUT'];

/** Millennium BCP: 13 header rows, then [date, value date, description, signed amount, Débito/Crédito, balance], then one footer row. */
function bcpSheet(rows: { amount: number; date: Date; description: string }[]) {
  const header = Array.from({ length: 13 }, () => [null]);
  const body = rows.map((row) => [row.date, row.date, row.description, row.amount, row.amount < 0 ? 'Débito' : 'Crédito', 0]);
  return [...header, ...body, [null]];
}

/** Montepio: 9 header rows, then [date, value date, description, signed amount as "1.234,56", balance]. */
function montepioSheet(rows: { amount: string; date: Date; description: string }[]) {
  const header = Array.from({ length: 9 }, () => [null]);
  return [...header, ...rows.map((row) => [row.date, row.date, row.description, row.amount, '0,00'])];
}

/*
 * A bank export already says which way the money went: the amount's sign. The import keeps that
 * sign and picks a transaction type that agrees with it; the type guessed from the description is
 * only a label. Every aggregate (cashflow, budgets, net worth, the balance chain) reads the stored
 * sign as the direction, so a flipped sign turns income into spending.
 */
describe('bank CSV import keeps the direction the bank file states', () => {
  const db = useTestDatabase();
  let household: Household;
  const day = (n: number) => new Date(Date.UTC(2026, 8, n, 12));

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of TYPE_NAMES) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  async function importSheet(bankName: string, sheet: unknown[][]) {
    parseExcelMock.mockResolvedValueOnce(sheet);
    return new AccountCsvImportService().importAccountCsv(
      { accountKey: household.account.accountKey, bankName, bucket: 'bucket', key: 'statement.xlsx' },
      { em: db.em(), getObjectBuffer: () => Promise.resolve(Buffer.from('xlsx')), getObjectSize: () => Promise.resolve(undefined) },
    );
  }

  async function stored() {
    const rows = await db.em().find(Transaction, { accountKey: household.account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionTypeKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, appuserAmount: row.appuserSettlementAmount, originalAmount: row.originalAmount, type: row.transactionTypeKey?.name }));
  }

  it('stores a credit whose description matches no pattern as income, not spending', async () => {
    await expect(importSheet('bcp', bcpSheet([{ amount: 1500, date: day(1), description: 'SALARIO ACME LDA' }]))).resolves.toMatchObject({ failed: 0, imported: 1 });

    expect(await stored()).toEqual([{ amount: 1500, appuserAmount: 1500, originalAmount: 1500, type: 'DEPOSIT' }]);
  });

  it('stores a recognised debit as an outflow of its guessed type', async () => {
    await importSheet('bcp', bcpSheet([{ amount: -42.5, date: day(2), description: 'COMPRA 1234 SUPERMERCADO' }]));

    expect(await stored()).toEqual([{ amount: -42.5, appuserAmount: -42.5, originalAmount: -42.5, type: 'CARD_PAYMENT' }]);
  });

  it('gives a credit an incoming type when the description looks like an outgoing one', async () => {
    await importSheet('bcp', bcpSheet([
      { amount: 20, date: day(3), description: 'COMPRA 1234 LOJA DEVOLUCAO' },
      { amount: 5, date: day(4), description: 'DD PT12345 OPERADORA' },
    ]));

    expect(await stored()).toEqual([
      { amount: 20, appuserAmount: 20, originalAmount: 20, type: 'CARD_REFUND' },
      { amount: 5, appuserAmount: 5, originalAmount: 5, type: 'DEPOSIT' },
    ]);
  });

  it('gives a debit an outgoing type when the description looks like an incoming one', async () => {
    await importSheet('bcp', bcpSheet([
      { amount: -100, date: day(5), description: 'TRANSF JOAO SILVA' },
      { amount: -50, date: day(6), description: 'DEPOSITO NUMERARIO   BALCAO' },
    ]));

    expect(await stored()).toEqual([
      { amount: -100, appuserAmount: -100, originalAmount: -100, type: 'PAYMENT' },
      { amount: -50, appuserAmount: -50, originalAmount: -50, type: 'PAYMENT' },
    ]);
  });

  it('keeps the file sign on a REVERT in either direction', async () => {
    await importSheet('montepio', montepioSheet([
      { amount: '-15,30', date: day(7), description: 'ANUL.CPR LOJA' },
      { amount: '1.015,30', date: day(8), description: 'ANUL.CPR LOJA' },
    ]));

    expect(await stored()).toEqual([
      { amount: -15.3, appuserAmount: -15.3, originalAmount: -15.3, type: 'REVERT' },
      { amount: 1015.3, appuserAmount: 1015.3, originalAmount: 1015.3, type: 'REVERT' },
    ]);
  });

  it('nets a statement to what the bank says moved', async () => {
    await importSheet('bcp', bcpSheet([
      { amount: 1500, date: day(1), description: 'SALARIO ACME LDA' },
      { amount: -42.5, date: day(2), description: 'COMPRA 1234 SUPERMERCADO' },
      { amount: -0.6, date: day(3), description: 'IMPOSTO DO SELO' },
    ]));

    const amounts = (await stored()).map((row) => row.amount ?? 0);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(1456.9, 4);
  });

  it('skips rows imported before this fix, whose id was built from the file amount', async () => {
    // A salary imported by the old code: stored negative, but its id carries the file's +1500.
    const em = db.em();
    const payment = await em.findOneOrFail(TransactionType, { name: 'PAYMENT' });
    em.create(Transaction, { accountKey: household.account, internalTransactionId: generateInternalTransactionId(day(1), 1500), nordigenInternalTransactionId: generateInternalTransactionId(day(1), 1500), settlementAmount: -1500, tenantKey: household.tenant, transactionDate: day(1), transactionStatusKey: household.statuses.BOOKED, transactionTypeKey: payment }, { partial: true });
    await em.flush();

    await expect(importSheet('bcp', bcpSheet([{ amount: 1500, date: day(1), description: 'SALARIO ACME LDA' }]))).resolves.toMatchObject({ imported: 0, skipped: 1 });
    expect(await stored()).toHaveLength(1);
  });

  it('does not duplicate a statement imported twice', async () => {
    const sheet = bcpSheet([{ amount: 1500, date: day(1), description: 'SALARIO ACME LDA' }, { amount: -42.5, date: day(2), description: 'COMPRA 1234 SUPERMERCADO' }]);
    await importSheet('bcp', sheet);

    await expect(importSheet('bcp', sheet)).resolves.toMatchObject({ imported: 0, skipped: 2 });
    expect(await stored()).toHaveLength(2);
  });
});
