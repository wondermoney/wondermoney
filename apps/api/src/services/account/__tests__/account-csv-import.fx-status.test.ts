import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, currencyFor, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FxStatus, Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import AccountCsvImportService from '@service/account/account-csv-import.service';

const GENERIC_HEADER = 'date,amount,currencyKey,merchant,description,internalTransactionId,transactionTypeKey';

/*
 * A CSV of rows in a currency WonderMoney has no rate for: each row keeps its own
 * amount and stores none in the owner's currency. 10,000 JPY is never stored as 10,000 EUR.
 */
describe('CSV import of rows in a currency with no exchange rate', () => {
  const db = useTestDatabase();
  const day = new Date(Date.UTC(2026, 8, 3, 12));

  async function importInto(currencyCode: string, rate?: number) {
    const em = db.em();
    const household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    const currency = await currencyFor(em, currencyCode);
    if (rate !== undefined) em.create(ExchangeRate, { date: new Date(Date.UTC(2026, 8, 2)), fromCurrency: currency, rate, toCurrency: household.currency }, { partial: true });
    await em.flush();
    const account = await addAccount(em, household, { balance: 50_000, currency, name: 'Tokyo' });
    const type = await em.findOneOrFail(TransactionType, { name: 'CARD_PAYMENT' });
    const csv = [GENERIC_HEADER, `${day.toISOString()},-10000,${currency.currencyKey},Ramen,,generic-1,${type.transactionTypeKey}`].join('\n');
    await new AccountCsvImportService().importAccountCsv(
      { accountKey: account.accountKey, bucket: 'bucket', key: 'generic.csv' },
      { em: db.em(), getObjectBuffer: () => Promise.resolve(Buffer.from(csv)), getObjectSize: () => Promise.resolve(undefined), getObjectText: () => Promise.resolve(csv) },
    );
    return db.em().findOneOrFail(Transaction, { accountKey: account }, { filters: false });
  }

  it('stores no converted amount and marks the row missing', async () => {
    const row = await importInto('JPY');

    expect(row).toMatchObject({ appuserSettlementAmount: null, fxStatus: FxStatus.MISSING, settlementAmount: -10_000 });
  });

  it('converts at the rate on or before the row\'s date and marks it exact', async () => {
    const row = await importInto('USD', 0.9);

    expect(row).toMatchObject({ appuserSettlementAmount: -9000, fxStatus: FxStatus.EXACT });
  });
});
