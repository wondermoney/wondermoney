import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ActualUnreadableError, actualImportAdapter, isActualFile } from '../lib/import/actual';
import { isYnabFile } from '../lib/import/ynab';

/*
 * The Actual Budget transactions reader: every row of the export with its account listed for the
 * mapping step, a payee naming another account (or `Transfer: <Account>`) read as one side of a
 * transfer, a split imported as one transaction for its total with its parts in the notes, and
 * categories listed for the category step.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'actual', name)));
const csv = (lines: string[]) => new TextEncoder().encode(lines.join('\n'));

const HEADER = 'Account,Date,Payee,Notes,Category,Amount,Split_Amount,Cleared';

const rowsOf = (result: Awaited<ReturnType<typeof actualImportAdapter.parse>>) =>
  result.rows.map((row) => ({
    account: row.normalized?.sourceAccountLabel,
    amount: row.normalized?.amount,
    category: row.normalized?.categoryLabel,
    date: row.normalized?.date.slice(0, 10),
    description: row.normalized?.description,
    notes: row.normalized?.notes,
    transfer: row.normalized?.transferAccountLabel,
    type: row.normalized?.typeHint,
  }));

describe('the Actual Budget export', () => {
  it('reads two accounts, a transfer between them and a split', async () => {
    const result = await actualImportAdapter.parse(fixture('transactions.csv'), {});

    expect(result.warnings).toEqual([]);
    expect(rowsOf(result)).toEqual([
      { account: 'Checking', amount: -400, category: undefined, date: '2026-02-03', description: 'Monthly saving', notes: undefined, transfer: 'Savings', type: 'TRANSFER_OUT' },
      { account: 'Checking', amount: 1500, category: 'Income', date: '2026-01-31', description: 'January salary', notes: undefined, transfer: undefined, type: undefined },
      { account: 'Checking', amount: -1234.56, category: 'Electricity', date: '2026-01-25', description: 'City Power', notes: undefined, transfer: undefined, type: undefined },
      { account: 'Checking', amount: -62.5, category: undefined, date: '2026-01-20', description: 'Weekly shop', notes: 'Groceries -50.00; Household -12.50 (Batteries)', transfer: undefined, type: undefined },
      { account: 'Checking', amount: -42.5, category: 'Groceries', date: '2026-01-15', description: 'Corner Grocer', notes: undefined, transfer: undefined, type: undefined },
      { account: 'Savings', amount: 400, category: undefined, date: '2026-02-03', description: 'Monthly saving', notes: undefined, transfer: 'Checking', type: 'TRANSFER_IN' },
      { account: 'Savings', amount: 2000, category: 'Starting Balances', date: '2026-01-01', description: 'Starting Balance', notes: undefined, transfer: undefined, type: undefined },
    ]);
    // The split's parts are not rows of their own: the parent stands for them, at its own line.
    expect(result.rows.map((row) => row.sourceRow)).toEqual([2, 3, 4, 5, 8, 9, 10]);
    expect(result.rows.find((row) => row.sourceRow === 5)?.normalized).toMatchObject({ merchant: 'Corner Market' });
    expect(result.rows[0]?.normalized).toMatchObject({ externalIdTrusted: false, merchant: 'Savings', typeIsUserSet: true });
  });

  it('lists every account and every category the imported rows use', async () => {
    const result = await actualImportAdapter.parse(fixture('transactions.csv'), {});

    expect(result.sourceAccounts).toEqual([
      { label: 'Checking', rowCount: 5 },
      { label: 'Savings', rowCount: 2 },
    ]);
    expect(result.sourceCategories).toEqual([
      { label: 'Income', name: 'Income', rowCount: 1 },
      { label: 'Electricity', name: 'Electricity', rowCount: 1 },
      { label: 'Groceries', name: 'Groceries', rowCount: 1 },
      { label: 'Starting Balances', name: 'Starting Balances', rowCount: 1 },
    ]);
  });

  it('gives every row an id that is the same when the file is read again, and distinct for repeats', async () => {
    const file = csv([HEADER, 'Checking,2026-03-01,Cafe,,,-3.5,0,Cleared', 'Checking,2026-03-01,Cafe,,,-3.5,0,Cleared', 'Savings,2026-03-01,Cafe,,,-3.5,0,Cleared']);

    const first = await actualImportAdapter.parse(file, {});
    const second = await actualImportAdapter.parse(file, {});

    const ids = first.rows.map((row) => row.normalized?.externalId);
    expect(new Set(ids.slice(0, 2)).size).toBe(2);
    expect(second.rows.map((row) => row.normalized?.externalId)).toEqual(ids);
  });
});

describe('splits', () => {
  it('takes the parent total from Split_Amount, and the one category every part shares', async () => {
    const result = await actualImportAdapter.parse(csv([
      HEADER,
      'Checking,2026-03-02,Market,(SPLIT INTO 2) ,,0,-30,Cleared',
      'Checking,2026-03-02,Market,(SPLIT 1 OF 2) Fruit,Groceries,-20,0,Cleared',
      'Checking,2026-03-02,Market,(SPLIT 2 OF 2) Bread,Groceries,-10,0,Cleared',
    ]), {});

    expect(rowsOf(result)).toEqual([{ account: 'Checking', amount: -30, category: 'Groceries', date: '2026-03-02', description: 'Market', notes: 'Groceries -20.00 (Fruit); Groceries -10.00 (Bread)', transfer: undefined, type: undefined }]);
    expect(result.sourceCategories).toEqual([{ label: 'Groceries', name: 'Groceries', rowCount: 1 }]);
  });

  it('adds up the parts when the file has no Split_Amount column', async () => {
    const result = await actualImportAdapter.parse(csv([
      'Account,Date,Payee,Notes,Category,Amount',
      'Checking,2026-03-02,Market,(SPLIT INTO 2) Shop,,0',
      'Checking,2026-03-02,Market,(SPLIT 1 OF 2) ,Groceries,-20',
      'Checking,2026-03-02,Market,(SPLIT 2 OF 2) ,Household,-5.25',
    ]), {});

    expect(rowsOf(result).map(({ amount, notes }) => ({ amount, notes }))).toEqual([{ amount: -25.25, notes: 'Groceries -20.00; Household -5.25' }]);
  });

  it('finds the parts whichever side of the parent they are, and keeps parts with no parent as rows', async () => {
    const result = await actualImportAdapter.parse(csv([
      HEADER,
      'Checking,2026-03-02,Market,(SPLIT 1 OF 2) ,Groceries,-20,0,Cleared',
      'Checking,2026-03-02,Market,(SPLIT INTO 2) ,,0,-25,Cleared',
      'Checking,2026-03-02,Market,(SPLIT 2 OF 2) ,Household,-5,0,Cleared',
      'Checking,2026-03-05,Hardware,(SPLIT 1 OF 2) Nails,Household,-4,0,Cleared',
    ]), {});

    expect(rowsOf(result).map(({ amount, category, description, notes }) => ({ amount, category, description, notes }))).toEqual([
      { amount: -25, category: undefined, description: 'Market', notes: 'Groceries -20.00; Household -5.00' },
      { amount: -4, category: 'Household', description: 'Nails', notes: undefined },
    ]);
  });
});

describe('transfers', () => {
  it('reads a payee that names another account of the file as a transfer, case and accents aside', async () => {
    const result = await actualImportAdapter.parse(csv([
      HEADER,
      'Conta à ordem,2026-03-02,POUPANCA,,,-100,0,Cleared',
      'Poupança,2026-03-02,Conta a Ordem,,,100,0,Cleared',
    ]), {});

    expect(rowsOf(result).map(({ transfer, type }) => ({ transfer, type }))).toEqual([
      { transfer: 'Poupança', type: 'TRANSFER_OUT' },
      { transfer: 'Conta à ordem', type: 'TRANSFER_IN' },
    ]);
  });

  it('reads a "Transfer: <Account>" payee as a transfer, even to an account the file does not hold', async () => {
    const result = await actualImportAdapter.parse(csv([
      HEADER,
      'Checking,2026-03-02,Transfer: Brokerage,,,-250,0,Cleared',
      'Checking,2026-03-03,Transfer : Savings,,,-50,0,Cleared',
      'Savings,2026-03-03,Transfer : Checking,,,50,0,Cleared',
    ]), {});

    expect(rowsOf(result).map(({ transfer, type }) => ({ transfer, type }))).toEqual([
      { transfer: 'Brokerage', type: 'TRANSFER_OUT' },
      { transfer: 'Savings', type: 'TRANSFER_OUT' },
      { transfer: 'Checking', type: 'TRANSFER_IN' },
    ]);
  });

  it('does not read a payee as a transfer when it names no other account, or the row\'s own', async () => {
    const result = await actualImportAdapter.parse(csv([HEADER, 'Checking,2026-03-02,Checking,,,-5,0,Cleared', 'Checking,2026-03-02,Savings Bank,,Fees,-2,0,Cleared']), {});

    expect(rowsOf(result).map(({ category, transfer }) => ({ category, transfer }))).toEqual([{ category: undefined, transfer: undefined }, { category: 'Fees', transfer: undefined }]);
  });
});

describe('reading the file', () => {
  it('reads the older export, whose category is "Group: Category" and Cleared a boolean', async () => {
    const result = await actualImportAdapter.parse(csv([
      'Account,Date,Payee,Notes,Category,Amount,Cleared,Reconciled',
      'Checking,2026-03-02,Market,,Food: Groceries,-20,true,false',
    ]), {});

    expect(result.sourceCategories).toEqual([{ group: 'Food', label: 'Food: Groceries', name: 'Groceries', rowCount: 1 }]);
    expect(rowsOf(result)[0]).toMatchObject({ amount: -20, category: 'Food: Groceries' });
  });

  it('reads a file a spreadsheet saved again, with semicolons, decimal commas and day-first dates', async () => {
    const result = await actualImportAdapter.parse(csv([
      'Account;Date;Payee;Notes;Category;Amount',
      'Checking;15/01/2026;Market;;Groceries;-1.234,50',
      'Checking;03/02/2026;Employer;;Income;2000',
    ]), {});

    expect(result.warnings).toEqual([]);
    expect(rowsOf(result).map(({ amount, date }) => ({ amount, date }))).toEqual([{ amount: -1234.5, date: '2026-01-15' }, { amount: 2000, date: '2026-02-03' }]);
  });

  it('keeps an unreadable line as an invalid row with the reason', async () => {
    const result = await actualImportAdapter.parse(csv([HEADER, 'Checking,someday,Market,,,-5,0,Cleared', 'Checking,2026-03-02,Market,,,lots,0,Cleared', ',2026-03-02,Market,,,-5,0,Cleared', 'Checking,2026-03-02,Market,,,,0,Cleared']), {});

    expect(result.rows.map((row) => row.error)).toEqual(['Unreadable date', 'Unreadable amount', 'Missing account', 'Unreadable amount']);
  });

  it('refuses a file without Actual\'s columns', async () => {
    await expect(actualImportAdapter.parse(csv(['Date,Description,Amount', '2026-03-02,Market,-5']), {})).rejects.toEqual(new ActualUnreadableError('columns_not_found'));
  });
});

describe('isActualFile', () => {
  it('recognises the export by its columns, and not a YNAB register or a bank statement', () => {
    expect(isActualFile(fixture('transactions.csv'))).toBe(true);
    expect(isActualFile(csv(['\uFEFF"Account","Date","Payee","Notes","Category","Amount"']))).toBe(true);
    const ynab = csv(['"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"']);
    expect(isActualFile(ynab)).toBe(false);
    expect(isYnabFile(fixture('transactions.csv'))).toBe(false);
    expect(isActualFile(csv(['Date,Description,Amount,Balance', '2026-03-02,Market,-5,100']))).toBe(false);
  });
});
