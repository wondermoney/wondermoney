import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Transaction } from '@entity/Transaction';
import { TransactionType } from '@entity/TransactionType';

// Job enqueues after the import; they have no bearing on the stored rows.
vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({ triggerRecurringDetectionAfterTransactionIngestion: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@service/transaction-enrichment/transaction-enrichment-enqueue.service', () => ({ enqueueTransactionEnrichmentForTenant: vi.fn().mockResolvedValue(undefined) }));

import AccountCsvImportService from '@service/account/account-csv-import.service';
import type { StatementMapping } from '@service/account/account-statement-mapping.schema';

/*
 * Any bank's export imports, not only the five with a parser of their own and the CSV template:
 * the columns are found by name, or taken from the mapping the person confirmed in the preview.
 */
describe('importing a statement export from any bank', () => {
  const db = useTestDatabase();
  let household: Household;

  beforeEach(async () => {
    const em = db.em();
    household = await seedHousehold(em);
    for (const name of ['CARD_PAYMENT', 'DEPOSIT', 'PAYMENT']) em.create(TransactionType, { displayName: name, name }, { partial: true });
    await em.flush();
  });

  function importFile(text: string, mapping?: StatementMapping) {
    return new AccountCsvImportService().importAccountCsv(
      { accountKey: household.account.accountKey, bucket: 'bucket', key: 'statement.csv', mapping },
      { em: db.em(), getObjectBuffer: () => Promise.resolve(Buffer.from(text, 'latin1')), getObjectSize: () => Promise.resolve(undefined), getObjectText: () => Promise.resolve(text) },
    );
  }

  async function stored() {
    const rows = await db.em().fork().find(Transaction, { accountKey: household.account }, { orderBy: { transactionDate: 'ASC' }, populate: ['transactionTypeKey', 'transactionMerchantKey'] });
    return rows.map((row) => ({ amount: row.settlementAmount, date: row.transactionDate?.toISOString().slice(0, 10), merchant: row.transactionMerchantKey?.name, type: row.transactionTypeKey?.name }));
  }

  const export_ = [
    'Movimentos da conta',
    '',
    'Data mov.;Data valor;Descrição;Débito;Crédito;Saldo',
    '02-09-2026;02-09-2026;CONTINENTE MATOSINHOS;42,50;;957,50',
    '05-09-2026;05-09-2026;SALARIO ACME LDA;;1.500,00;2.457,50',
    'Saldo final;;;;;2.457,50',
  ].join('\r\n');

  it('imports a bank export with no parser of its own, money out negative and money in positive', async () => {
    await expect(importFile(export_)).resolves.toMatchObject({ failed: 0, imported: 2 });

    expect(await stored()).toEqual([
      { amount: -42.5, date: '2026-09-02', merchant: 'CONTINENTE MATOSINHOS', type: 'PAYMENT' },
      { amount: 1500, date: '2026-09-05', merchant: 'SALARIO ACME LDA', type: 'DEPOSIT' },
    ]);
  });

  it('skips the lines it already has when the same export is imported again', async () => {
    await importFile(export_);

    await expect(importFile(export_)).resolves.toMatchObject({ imported: 0, skipped: 2 });
    expect(await stored()).toHaveLength(2);
  });

  it('reads the file with the columns the person picked', async () => {
    const text = 'when|what|in|out\n2026-09-10|Rent|0|700\n2026-09-11|Refund|20|0\n';
    const mapping: StatementMapping = { columns: { credit: 2, date: 0, debit: 3, description: 1 }, dateFormat: 'YMD', decimalSeparator: '.', headerRowIndex: 0, invertAmounts: false };

    await expect(importFile(text, mapping)).resolves.toMatchObject({ imported: 2 });
    expect((await stored()).map((row) => row.amount)).toEqual([-700, 20]);
  });

  it('fails the import when the columns cannot be found', async () => {
    await expect(importFile('foo;bar\nx;y\n')).rejects.toThrow('Could not work out the columns');
  });
});
