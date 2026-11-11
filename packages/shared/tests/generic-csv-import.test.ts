import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { genericCsvImportAdapter, isGenericCsvTemplate } from '../lib/import/generic-csv';

/*
 * The older WonderMoney CSV template: its fixed columns, the numeric type that decides the sign,
 * the optional currency column, the rows it cannot read, and the header test the session uses to
 * pick the adapter.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'generic-csv', name));

const options = {
  accountCurrency: 'EUR',
  currencies: { '2': 'USD' },
  transactionTypes: { '3': 'PAYMENT', '8': 'DEPOSIT', '14': 'FEE' },
};

const parse = (name: string) => genericCsvImportAdapter.parse(new Uint8Array(fixture(name)), options);

const rowsOf = (result: Awaited<ReturnType<typeof parse>>) =>
  result.rows.map((row) => ({
    amount: row.normalized?.amount,
    currency: row.normalized?.currency,
    date: row.normalized?.date.slice(0, 10),
    description: row.normalized?.description,
    error: row.error,
    externalId: row.normalized?.externalId,
    merchant: row.normalized?.merchant,
    sourceRow: row.sourceRow,
    type: row.normalized?.typeHint,
    userSet: row.normalized?.typeIsUserSet,
  }));

describe('the generic CSV template', () => {
  it('reads each row with the type deciding the direction, whatever sign the file uses', async () => {
    const result = await parse('template.csv');

    expect(result.sourceAccounts).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { amount: -23.4, currency: undefined, date: '2026-01-15', description: 'Weekly shop', error: undefined, externalId: 'example-1', merchant: 'Grocery store', sourceRow: 2, type: 'PAYMENT', userSet: true },
      { amount: 1500, currency: undefined, date: '2026-01-31', description: 'Salary', error: undefined, externalId: 'example-2', merchant: 'Employer', sourceRow: 3, type: 'DEPOSIT', userSet: true },
      { amount: -12, currency: undefined, date: '2026-02-03', description: '', error: undefined, externalId: 'example-3', merchant: 'Coffee shop', sourceRow: 4, type: 'PAYMENT', userSet: true },
    ]);
  });

  it('reads the date as the one-step import did, and the optional currency by its key', async () => {
    const result = await parse('quirks.csv');
    const rows = rowsOf(result);

    expect(rows.slice(0, 3)).toEqual([
      { amount: -10.5, currency: undefined, date: '2026-01-15', description: 'Desc', error: undefined, externalId: 'int-1', merchant: 'Shop', sourceRow: 2, type: 'PAYMENT', userSet: true },
      { amount: 42, currency: 'USD', date: '2026-02-01', description: 'Lunch, with friends', error: undefined, externalId: 'int-2', merchant: 'Café, Lda.', sourceRow: 3, type: 'DEPOSIT', userSet: true },
      { amount: -7.25, currency: undefined, date: '2026-03-05', description: '', error: undefined, externalId: 'int-3', merchant: 'Bakery', sourceRow: 4, type: 'FEE', userSet: true },
    ]);
  });

  it('reports each unreadable row on its own line and never guesses', async () => {
    const result = await parse('quirks.csv');
    const errors = result.rows.filter((row) => row.error !== undefined).map((row) => ({ error: row.error, sourceRow: row.sourceRow }));

    expect(errors).toEqual([
      { error: 'Unreadable date', sourceRow: 5 },
      { error: 'Unreadable amount', sourceRow: 6 },
      { error: 'Unknown transaction type: 999999', sourceRow: 7 },
      { error: 'Missing merchant', sourceRow: 8 },
      { error: 'Invalid transaction type', sourceRow: 9 },
      { error: 'Unknown currency: 99', sourceRow: 10 },
    ]);
    expect(result.rows.filter((row) => row.error !== undefined).every((row) => row.normalized === undefined)).toBe(true);
  });

  it('keeps the file sign for a type with no direction', async () => {
    const csv = ['date,amount,merchant,internalTransactionId,transactionTypeKey', '2026-09-01,-50,Mix,ex-1,6', '2026-09-02,75,Mix,ex-2,6', '2026-09-03,-12.30,Back,rev-1,10'].join('\n');

    const result = await genericCsvImportAdapter.parse(new TextEncoder().encode(csv), { transactionTypes: { '6': 'EXCHANGE', '10': 'REVERT' } });

    expect(result.rows.map((row) => ({ amount: row.normalized?.amount, type: row.normalized?.typeHint }))).toEqual([
      { amount: -50, type: 'EXCHANGE' },
      { amount: 75, type: 'EXCHANGE' },
      { amount: -12.3, type: 'REVERT' },
    ]);
  });

  it('refuses a file whose columns are not the template', async () => {
    await expect(genericCsvImportAdapter.parse(new TextEncoder().encode('date,amount\n2026-01-01,-1'), options)).rejects.toMatchObject({ code: 'columns_not_found' });
  });

  it('recognizes the template by its header, with or without a BOM, and nothing else', () => {
    expect(isGenericCsvTemplate(new Uint8Array(fixture('template.csv')))).toBe(true);
    expect(isGenericCsvTemplate(new TextEncoder().encode('internalTransactionId,transactionTypeKey\n1,2'))).toBe(true);
    expect(isGenericCsvTemplate(new TextEncoder().encode('Data mov.;Descrição;Débito;Crédito\n02-09-2026;SHOP;10;'))).toBe(false);
    expect(isGenericCsvTemplate(new TextEncoder().encode('OFXHEADER:100\n<OFX>'))).toBe(false);
  });
});
