import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isQifFile } from '../lib/import/qif';
import { isYnabFile, ynabImportAdapter, YnabUnreadableError } from '../lib/import/ynab';

/*
 * The YNAB register reader: the YNAB web export and the YNAB 4 export, with the amount as Inflow
 * minus Outflow in the file's number format, the date order read from every date, every account
 * listed for the mapping step, transfers named by their `Transfer : <Account>` payee, categories
 * listed for the category step, and "Ready to Assign" inflows read as income with no category.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'ynab', name)));
const csv = (lines: string[]) => new TextEncoder().encode(lines.join('\n'));

const WEB_HEADER = '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';
const webRow = (fields: { account?: string; category?: string; date: string; group?: string; inflow?: string; memo?: string; outflow?: string; payee?: string }) =>
  [
    fields.account ?? 'Checking',
    '',
    fields.date,
    fields.payee ?? 'Shop',
    fields.group && fields.category ? `${fields.group}: ${fields.category}` : '',
    fields.group ?? '',
    fields.category ?? '',
    fields.memo ?? '',
    fields.outflow ?? '',
    fields.inflow ?? '',
    'Cleared',
  ]
    .map((value) => `"${value}"`)
    .join(',');

const rowsOf = (result: Awaited<ReturnType<typeof ynabImportAdapter.parse>>) =>
  result.rows.map((row) => ({
    account: row.normalized?.sourceAccountLabel,
    amount: row.normalized?.amount,
    category: row.normalized?.categoryLabel,
    date: row.normalized?.date.slice(0, 10),
    transfer: row.normalized?.transferAccountLabel,
    type: row.normalized?.typeHint,
  }));

describe('the YNAB web export', () => {
  it('reads every row as Inflow minus Outflow, in the order the dates settle (month first)', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});

    expect(result.warnings).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { account: 'Checking', amount: -42.5, category: 'Everyday Expenses: Groceries', date: '2026-01-15', transfer: undefined, type: undefined },
      { account: 'Checking', amount: 1500, category: undefined, date: '2026-01-31', transfer: undefined, type: 'DEPOSIT' },
      { account: 'Checking', amount: -400, category: undefined, date: '2026-02-03', transfer: 'Savings', type: 'TRANSFER_OUT' },
      { account: 'Checking', amount: -1234.56, category: 'Bills: Electricity', date: '2026-01-25', transfer: undefined, type: undefined },
      { account: 'Savings', amount: 400, category: undefined, date: '2026-02-03', transfer: 'Checking', type: 'TRANSFER_IN' },
      { account: 'Savings', amount: 2000, category: undefined, date: '2026-01-01', transfer: undefined, type: 'DEPOSIT' },
      { account: 'Credit Card', amount: -18.75, category: 'Fun: Dining Out', date: '2026-01-20', transfer: undefined, type: undefined },
      { account: 'Credit Card', amount: 5.25, category: 'Fun: Dining Out', date: '2026-01-22', transfer: undefined, type: undefined },
    ]);
  });

  it('lists every account in the file for the mapping step, with its row count', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});

    expect(result.sourceAccounts).toEqual([
      { label: 'Checking', rowCount: 4 },
      { label: 'Savings', rowCount: 2 },
      { label: 'Credit Card', rowCount: 2 },
    ]);
  });

  it('lists the categories to map, with their group, and leaves Ready to Assign and transfers out', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});

    expect(result.sourceCategories).toEqual([
      { group: 'Everyday Expenses', label: 'Everyday Expenses: Groceries', name: 'Groceries', rowCount: 1 },
      { group: 'Bills', label: 'Bills: Electricity', name: 'Electricity', rowCount: 1 },
      { group: 'Fun', label: 'Fun: Dining Out', name: 'Dining Out', rowCount: 2 },
    ]);
  });

  it('takes the payee as the merchant and the memo as the description', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});

    expect(result.rows[0]?.normalized).toMatchObject({ description: 'Weekly shop', merchant: 'Corner Grocer' });
    expect(result.rows[3]?.normalized).toMatchObject({ description: 'City Power', merchant: 'City Power' });
    expect(result.rows[0]?.raw).toMatchObject({ account: 'Checking', category: 'Everyday Expenses: Groceries', date: '01/15/2026', inflow: '$0.00', outflow: '$42.50', payee: 'Corner Grocer' });
  });

  it('marks the transfer rows as transfers the file states, for transfer matching to pair', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});
    const transfers = result.rows.filter((row) => row.normalized?.transferAccountLabel !== undefined);

    expect(transfers.map((row) => row.normalized?.typeIsUserSet)).toEqual([true, true]);
  });

  it('numbers its rows as the lines of the file, after the header', async () => {
    const result = await ynabImportAdapter.parse(fixture('web-register.csv'), {});

    expect(result.rows.map((row) => row.sourceRow)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('fingerprints each row by date and amount within its account, never as a trusted id', async () => {
    const file = csv([WEB_HEADER, webRow({ date: '2026-01-15', outflow: '3.20' }), webRow({ date: '2026-01-15', outflow: '3.20' }), webRow({ account: 'Card', date: '2026-01-15', outflow: '3.20' })]);
    const result = await ynabImportAdapter.parse(file, {});

    expect(result.rows.map((row) => [row.normalized?.externalId, row.normalized?.externalIdTrusted])).toEqual([
      ['ynab-fp:2026-01-15|-3.20|0', false],
      ['ynab-fp:2026-01-15|-3.20|1', false],
      ['ynab-fp:2026-01-15|-3.20|0', false],
    ]);
  });

  it('lists the account of a file that holds only one', async () => {
    const file = csv([WEB_HEADER, webRow({ date: '2026-01-15', outflow: '3.20' })]);
    const result = await ynabImportAdapter.parse(file, {});

    expect(result.sourceAccounts).toEqual([{ label: 'Checking', rowCount: 1 }]);
  });

  it('reads the older "To be Budgeted" inflow as income with no category, like Ready to Assign', async () => {
    const file = csv([WEB_HEADER, webRow({ category: 'To be Budgeted', date: '2026-01-15', group: 'Inflow', inflow: '10.00' })]);
    const result = await ynabImportAdapter.parse(file, {});

    expect(rowsOf(result)[0]).toMatchObject({ amount: 10, category: undefined, type: 'DEPOSIT' });
    expect(result.sourceCategories).toEqual([]);
  });
});

describe('the YNAB 4 export', () => {
  it('reads every row as Inflow minus Outflow in the file\'s comma-decimal format, day first', async () => {
    const result = await ynabImportAdapter.parse(fixture('ynab4-register.csv'), {});

    expect(result.warnings).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { account: 'Conta à ordem', amount: -42.5, category: 'Despesas diárias: Supermercado', date: '2026-01-15', transfer: undefined, type: undefined },
      { account: 'Conta à ordem', amount: 1500, category: undefined, date: '2026-01-31', transfer: undefined, type: 'DEPOSIT' },
      { account: 'Conta à ordem', amount: -400, category: undefined, date: '2026-02-03', transfer: 'Poupança', type: 'TRANSFER_OUT' },
      { account: 'Conta à ordem', amount: -1234.56, category: 'Lazer: Restaurantes', date: '2026-02-20', transfer: undefined, type: undefined },
      { account: 'Poupança', amount: 400, category: undefined, date: '2026-02-03', transfer: 'Conta à ordem', type: 'TRANSFER_IN' },
    ]);
  });

  it('lists its accounts and its master and sub categories', async () => {
    const result = await ynabImportAdapter.parse(fixture('ynab4-register.csv'), {});

    expect(result.sourceAccounts).toEqual([
      { label: 'Conta à ordem', rowCount: 4 },
      { label: 'Poupança', rowCount: 1 },
    ]);
    expect(result.sourceCategories).toEqual([
      { group: 'Despesas diárias', label: 'Despesas diárias: Supermercado', name: 'Supermercado', rowCount: 1 },
      { group: 'Lazer', label: 'Lazer: Restaurantes', name: 'Restaurantes', rowCount: 1 },
    ]);
  });
});

describe('amounts in the file\'s number format', () => {
  const amounts = async (rows: { inflow?: string; outflow?: string }[]) => {
    const result = await ynabImportAdapter.parse(csv([WEB_HEADER, ...rows.map((row, index) => webRow({ date: `2026-01-${String(index + 13).padStart(2, '0')}`, ...row }))]), {});
    return result.rows.map((row) => row.normalized?.amount ?? row.error);
  };

  it('strips the currency symbol and the thousands separator, wherever the symbol sits', async () => {
    expect(await amounts([{ outflow: '$1,234.56' }, { inflow: '€2,000.10' }, { outflow: 'USD 15.00' }, { inflow: '1,000.00 kr' }])).toEqual([-1234.56, 2000.1, -15, 1000]);
  });

  it('reads comma decimals with dot, space or no-break space thousands', async () => {
    expect(await amounts([{ outflow: '1.234,56 €' }, { inflow: '2 000,10 €' }, { outflow: '3 500,00 €' }, { inflow: '4 000,25 €' }, { outflow: '12,30 €' }])).toEqual([-1234.56, 2000.1, -3500, 4000.25, -12.3]);
  });

  it('reads apostrophe thousands (Swiss)', async () => {
    expect(await amounts([{ outflow: "CHF 1'234.50" }, { inflow: "CHF 12'000.00" }])).toEqual([-1234.5, 12000]);
  });

  it('reads a separator before three digits by the rest of the file: thousands beside dot decimals', async () => {
    expect(await amounts([{ outflow: '$1,234' }, { inflow: '$10.50' }])).toEqual([-1234, 10.5]);
  });

  it('reads a separator before three digits by the rest of the file: thousands beside comma decimals', async () => {
    expect(await amounts([{ outflow: '1.234 €' }, { inflow: '10,50 €' }])).toEqual([-1234, 10.5]);
  });

  it('reads a currency with no minor unit, whose every amount has a thousands separator', async () => {
    expect(await amounts([{ outflow: '¥1,234' }, { inflow: '¥250,000' }, { outflow: '¥980' }])).toEqual([-1234, 250000, -980]);
  });

  it('nets a row with both an outflow and an inflow, and reads a minus or brackets as a negative', async () => {
    expect(await amounts([{ inflow: '$5.00', outflow: '$12.00' }, { inflow: '-$3.00' }, { outflow: '($4.00)' }])).toEqual([-7, -3, 4]);
  });

  it('reads an empty cell as zero, and a cell with no number at all as unreadable', async () => {
    expect(await amounts([{ inflow: '', outflow: '$8.00' }, { inflow: 'n/a' }])).toEqual([-8, 'Unreadable amount']);
  });
});

describe('dates', () => {
  const dates = (values: string[], options: Parameters<typeof ynabImportAdapter.parse>[1] = {}) =>
    ynabImportAdapter.parse(csv([WEB_HEADER, ...values.map((date) => webRow({ date, outflow: '1.00' }))]), options);

  it('reads the file day first when a day above 12 says so', async () => {
    const result = await dates(['03/02/2026', '25/02/2026']);

    expect(result.warnings).toEqual([]);
    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-02-03', '2026-02-25']);
  });

  it('reads ISO dates as they are', async () => {
    const result = await dates(['2026-02-03', '2026-12-01']);

    expect(result.warnings).toEqual([]);
    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-02-03', '2026-12-01']);
  });

  it('asks for the order when every date is ambiguous, reading day first meanwhile, and reads again with the choice', async () => {
    const first = await dates(['01/02/2026', '03/04/2026']);
    expect(first.warnings).toEqual([{ code: 'date_order_ambiguous', detail: 'day-first' }]);
    expect(first.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-02-01', '2026-04-03']);

    const again = await dates(['01/02/2026', '03/04/2026'], { dateOrder: 'month-first' });
    expect(again.warnings).toEqual([]);
    expect(again.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-02', '2026-03-04']);
  });

  it('reports dates that disagree on the order', async () => {
    const result = await dates(['13/01/2026', '01/13/2026']);

    expect(result.warnings).toEqual([{ code: 'date_order_conflict', detail: 'day-first' }]);
  });

  it('keeps a row whose date does not read as an unreadable row', async () => {
    const result = await dates(['2026-01-15', 'soon']);

    expect(result.rows.map((row) => row.error)).toEqual([undefined, 'Unreadable date']);
  });
});

describe('telling a YNAB export apart', () => {
  it('recognises both exports by their columns', () => {
    expect(isYnabFile(fixture('web-register.csv'))).toBe(true);
    expect(isYnabFile(fixture('ynab4-register.csv'))).toBe(true);
    expect(isQifFile(fixture('web-register.csv'))).toBe(false);
  });

  it('does not take a bank statement or the WonderMoney template for one', () => {
    expect(isYnabFile(csv(['Date,Description,Amount,Balance', '2026-01-15,Shop,-1.00,10.00']))).toBe(false);
    expect(isYnabFile(csv(['date,amount,merchant,internalTransactionId,transactionTypeKey', '2026-01-15,1,Shop,a,1']))).toBe(false);
  });

  it('refuses a file whose columns are not a YNAB register', async () => {
    await expect(ynabImportAdapter.parse(csv(['Date,Description,Amount', '2026-01-15,Shop,-1.00']), {})).rejects.toBeInstanceOf(YnabUnreadableError);
  });
});
