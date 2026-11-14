import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isQifFile, qifImportAdapter } from '../lib/import/qif';

/*
 * The QIF reader: a bank file in day-first order with comma decimals, a credit-card file in
 * month-first order, a file whose dates are all ambiguous, Quicken's two-digit years and `'` year
 * separator, a split record, a file with two `!Account` blocks, transfer and category labels, and
 * the lists it skips.
 */
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'qif', name));

const parse = (name: string, options: Parameters<typeof qifImportAdapter.parse>[1] = {}) =>
  qifImportAdapter.parse(new Uint8Array(fixture(name)), options);

const rowsOf = (result: Awaited<ReturnType<typeof parse>>) =>
  result.rows.map((row) => ({
    amount: row.normalized?.amount,
    date: row.normalized?.date.slice(0, 10),
    description: row.normalized?.description,
    externalId: row.normalized?.externalId,
    merchant: row.normalized?.merchant,
    sourceAccountLabel: row.normalized?.sourceAccountLabel,
    trusted: row.normalized?.externalIdTrusted,
  }));

describe('a bank file', () => {
  it('reads every record with the sign the file states, in day-first order', async () => {
    const result = await parse('bank-day-first.qif');

    expect(result.sourceAccounts).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { amount: -42.5, date: '2026-01-15', description: 'Groceries', externalId: 'qif-fp:2026-01-15|-42.50|0', merchant: 'CONTINENTE MATOSINHOS', sourceAccountLabel: undefined, trusted: false },
      { amount: 1500, date: '2026-01-31', description: 'January salary', externalId: 'qif-fp:2026-01-31|1500.00|0', merchant: 'SALARIO ACME LDA', sourceAccountLabel: undefined, trusted: false },
      { amount: -12.3, date: '2026-03-02', description: 'Pharmacy', externalId: 'qif-fp:2026-03-02|-12.30|0', merchant: 'FARMACIA CENTRAL', sourceAccountLabel: undefined, trusted: false },
    ]);
  });

  it('takes the category from L, without the class a slash introduces', async () => {
    const result = await parse('bank-day-first.qif');

    expect(result.rows.map((row) => row.normalized?.categoryLabel)).toEqual(['Food:Groceries', 'Salary', undefined]);
  });

  it('does not ask for the date order when a day above 12 settles it', async () => {
    const result = await parse('bank-day-first.qif');

    expect(result.warnings).toEqual([]);
  });

  it('keeps the check number and the raw fields for the review', async () => {
    const result = await parse('bank-day-first.qif');

    expect(result.rows[0]?.raw).toMatchObject({ amount: '-42,50', category: 'Food:Groceries', checkNumber: '1234', date: '15/01/2026', memo: 'Groceries', payee: 'CONTINENTE MATOSINHOS' });
  });
});

describe('a credit-card file', () => {
  it('reads charges as money out and the payment as money in, in month-first order', async () => {
    const result = await parse('card-month-first.qif');

    expect(rowsOf(result).map((row) => ({ amount: row.amount, date: row.date }))).toEqual([
      { amount: -89.99, date: '2026-01-15' },
      { amount: -45, date: '2026-02-03' },
      { amount: 500, date: '2026-02-10' },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe('the date order', () => {
  it('asks when every date in the file is ambiguous, reading day-first meanwhile', async () => {
    const result = await parse('ambiguous-dates.qif');

    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'date_order_ambiguous', detail: 'day-first' }));
    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-02-01', '2026-04-03', '2026-06-05']);
  });

  it('reads the file month-first when the person chooses, and does not ask again', async () => {
    const result = await parse('ambiguous-dates.qif', { dateOrder: 'month-first' });

    expect(result.warnings).toEqual([]);
    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-02', '2026-03-04', '2026-05-06']);
  });

  it('does not ask when the file itself is month-first', async () => {
    const result = await parse('card-month-first.qif');

    expect(result.warnings.filter((warning) => warning.code === 'date_order_ambiguous')).toEqual([]);
  });

  it('lists a date that cannot be the order the person chose as unreadable', async () => {
    const result = await parse('bank-day-first.qif', { dateOrder: 'month-first' });

    expect(result.rows[0]).toMatchObject({ error: 'Unreadable date', sourceRow: 2 });
    expect(result.rows[1]).toMatchObject({ error: 'Unreadable date', sourceRow: 9 });
    expect(result.rows[2]?.normalized?.date.slice(0, 10)).toBe('2026-02-03');
  });
});

describe('two-digit years', () => {
  it("reads Quicken's ' year separator and pivots two-digit years at 50", async () => {
    const result = await parse('two-digit-years.qif');

    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-15', '1999-12-31', '2005-03-04']);
  });

  it('reads a year-first date as it is written', async () => {
    const result = await parse('iso-dates.qif');

    expect(result.rows.map((row) => row.normalized?.date.slice(0, 10))).toEqual(['2026-01-15', '2026-02-03']);
    expect(result.warnings).toEqual([]);
  });
});

describe('split records', () => {
  it('imports one transaction with the record total and the breakdown in the description', async () => {
    const result = await parse('splits.qif');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.normalized).toMatchObject({ amount: -42.4, description: 'Weekly shop — Split: Food:Groceries -30.00; Household -12.40' });
    expect(result.rows[0]?.raw).toMatchObject({ splits: [{ amount: '-30.00', category: 'Food:Groceries', memo: 'Groceries' }, { amount: '-12.40', category: 'Household', memo: 'Cleaning' }] });
  });
});

describe('a file with several accounts', () => {
  it('names each !Account block and labels its rows', async () => {
    const result = await parse('two-accounts.qif');

    expect(result.sourceAccounts).toEqual([
      { label: 'Checking', rowCount: 2 },
      { label: 'Card', rowCount: 1 },
    ]);
    expect(result.rows.map((row) => row.normalized?.sourceAccountLabel)).toEqual(['Checking', 'Checking', 'Card']);
  });
});

describe('transfers and categories', () => {
  it('marks an L[Account] category as a transfer, with the other account and the direction', async () => {
    const result = await parse('transfers-and-categories.qif');
    const rows = result.rows.map((row) => row.normalized);

    expect(rows[0]).toMatchObject({ amount: -200, transferAccountLabel: 'Savings', typeHint: 'TRANSFER_OUT', typeIsUserSet: true });
    expect(rows[0]?.categoryLabel).toBeUndefined();
    expect(rows[2]).toMatchObject({ amount: 500, transferAccountLabel: 'Savings', typeHint: 'TRANSFER_IN' });
  });

  it('keeps a plain L category as the row category, without the class', async () => {
    const result = await parse('transfers-and-categories.qif');

    expect(result.rows[1]?.normalized?.categoryLabel).toBe('Subscriptions:Music');
    expect(result.rows[1]?.normalized?.transferAccountLabel).toBeUndefined();
  });
});

describe('the lists it does not import', () => {
  it('skips a category list and an investment list, warning about the investment records', async () => {
    const result = await parse('category-and-investment-lists.qif');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.normalized?.merchant).toBe('COFFEE');
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'investment_records_skipped' }));
  });
});

describe('isQifFile', () => {
  it('recognises the header styles and refuses anything else', () => {
    expect(isQifFile(new Uint8Array(fixture('bank-day-first.qif')))).toBe(true);
    expect(isQifFile(new Uint8Array(fixture('two-accounts.qif')))).toBe(true);
    expect(isQifFile(new Uint8Array(Buffer.from('date,amount\n2026-09-01,-1\n')))).toBe(false);
    expect(isQifFile(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'ofx', 'statement-sgml.ofx'))))).toBe(false);
  });

  it('reads a file that starts with a UTF-8 byte-order mark', () => {
    expect(isQifFile(new Uint8Array(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('!Type:Bank\n^\n')])))).toBe(true);
  });
});
