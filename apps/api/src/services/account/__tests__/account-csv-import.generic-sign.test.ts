import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Account } from '@entity/Account';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

// Job enqueues after the import; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import AccountCsvImportService from '@service/account/account-csv-import.service';

const TYPE_NAMES = ['CARD_PAYMENT', 'DEPOSIT', 'EXCHANGE', 'REVERT'] as const;
const HEADER = 'date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey';

/*
 * The generic CSV format carries a type code per row. For a type with a direction (a card payment,
 * a deposit) the type decides the sign and the amount is a magnitude, the same contract as manual
 * entry. EXCHANGE and REVERT have no direction, so only the file's sign says which way the money
 * went: dropping it turns a currency exchange out of the account, or a reversed credit, into income.
 */
describe('generic CSV import signs each row by its type, and keeps the file sign when the type has no direction', () => {
  const db = useTestDatabase();
  let household: Household;
  let typeKeys: Record<(typeof TYPE_NAMES)[number], number>;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    const types = TYPE_NAMES.map((name) => em.create(TransactionType, { displayName: name, name }, { partial: true }));
    await em.flush();
    typeKeys = Object.fromEntries(types.map((type) => [type.name, type.transactionTypeKey])) as typeof typeKeys;
  });

  async function importCsv(rows: { amount: string; type: (typeof TYPE_NAMES)[number] }[]) {
    const body = rows.map((row, i) => `2026-09-${String(i + 1).padStart(2, '0')},${row.amount},,Merchant ${i},,generic-${i},${typeKeys[row.type]}`);
    return new AccountCsvImportService().importAccountCsv(
      { accountKey: household.account.accountKey, bucket: 'bucket', key: 'generic.csv' },
      { em: db.em(), getObjectSize: () => Promise.resolve(undefined), getObjectText: () => Promise.resolve([HEADER, ...body].join('\n')) },
    );
  }

  async function stored() {
    const rows = await db.em().find(Transaction, { accountKey: household.account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionTypeKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, appuserAmount: row.appuserSettlementAmount, type: row.transactionTypeKey?.name }));
  }

  it('stores a negative EXCHANGE or REVERT row as an outflow, and a positive one as an inflow', async () => {
    await expect(importCsv([
      { amount: '-50', type: 'EXCHANGE' },
      { amount: '-12.30', type: 'REVERT' },
      { amount: '75', type: 'EXCHANGE' },
      { amount: '8', type: 'REVERT' },
    ])).resolves.toMatchObject({ failed: 0, imported: 4 });

    expect(await stored()).toEqual([
      { amount: -50, appuserAmount: -50, type: 'EXCHANGE' },
      { amount: -12.3, appuserAmount: -12.3, type: 'REVERT' },
      { amount: 75, appuserAmount: 75, type: 'EXCHANGE' },
      { amount: 8, appuserAmount: 8, type: 'REVERT' },
    ]);
  });

  it('still lets the type decide the direction for directional types, whatever sign the file uses', async () => {
    await importCsv([
      { amount: '-42.50', type: 'CARD_PAYMENT' },
      { amount: '42.50', type: 'CARD_PAYMENT' },
      { amount: '-100', type: 'DEPOSIT' },
      { amount: '100', type: 'DEPOSIT' },
    ]);

    expect(await stored()).toEqual([
      { amount: -42.5, appuserAmount: -42.5, type: 'CARD_PAYMENT' },
      { amount: -42.5, appuserAmount: -42.5, type: 'CARD_PAYMENT' },
      { amount: 100, appuserAmount: 100, type: 'DEPOSIT' },
      { amount: 100, appuserAmount: 100, type: 'DEPOSIT' },
    ]);
  });

  it('moves the account balance by the signed amounts', async () => {
    await importCsv([
      { amount: '-50', type: 'EXCHANGE' },
      { amount: '-12.30', type: 'REVERT' },
      { amount: '20', type: 'DEPOSIT' },
    ]);

    const account = await db.em().findOneOrFail(Account, { accountKey: household.account.accountKey });
    expect(account.balance).toBeCloseTo(1000 - 50 - 12.3 + 20, 2);
  });
});
