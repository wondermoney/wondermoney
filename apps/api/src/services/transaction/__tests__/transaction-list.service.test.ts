import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { Transaction } from '@entity/Transaction';

/** A fake EntityManager that answers by entity, so the module's query order is free to change. */
const db = vi.hoisted(() => ({
  count: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  many: new Map<unknown, unknown[]>(),
  one: new Map(),
}));

vi.mock('@app/app', () => ({ DI: { em: { count: db.count, find: db.find, findOne: db.findOne } } }));
vi.mock('@app/database/di', () => ({ DI: { em: { count: db.count, find: db.find, findOne: db.findOne } } }));

import { listTransactions, type TransactionListRequest } from '../transaction-list.service';

const eur = { code: 'EUR' };

function account(accountKey: number, opts: { linked?: boolean; logoUrl?: null | string } = {}) {
  return {
    accountFinancialInstitutionKey: opts.logoUrl === undefined ? undefined : { logoUrl: opts.logoUrl },
    accountKey,
    accountName: `Account ${accountKey}`,
    appuserCurrencyBalance: 50,
    balance: 50,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    currencyKey: eur,
    nordigenRequisitionKey: opts.linked ? 'req' : undefined,
  };
}

function loanLink(transactionKey: number, loanKey: number, name: string, amounts: { feeAmount: number; interestAmount: number; principalAmount: number }) {
  return { ...amounts, loanKey: { loanKey, name }, transactionKey: { transactionKey } };
}

function request(overrides: Partial<TransactionListRequest> = {}): TransactionListRequest {
  return { filters: {}, limit: 100, scope: 'all-accounts', tenantKey: 11, viewerAppuserKey: 1, ...overrides };
}

function transaction(transactionKey: number, accountKey: number) {
  return {
    accountKey: { accountFinancialInstitutionKey: { logoUrl: null }, accountKey, accountName: `Account ${accountKey}`, currencyKey: eur },
    appuserTransactionCategories: { map: () => [] },
    balance: 10,
    description: 'Groceries',
    reviewed: true,
    settlementAmount: -10,
    settlementCurrencyKey: eur,
    transactionDate: new Date('2026-02-01T00:00:00.000Z'),
    transactionKey,
    transactionTags: { getItems: () => [] },
    transactionTypeKey: { name: 'debit' },
  };
}

const transactionFind = () => db.find.mock.calls.find(([entity]) => entity === Transaction);

describe('listTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.many.clear();
    db.one.clear();
    db.one.set(Appuser, { appuserKey: 1, currencyKey: eur });
    db.find.mockImplementation((entity: unknown) => Promise.resolve(db.many.get(entity) ?? []));
    db.findOne.mockImplementation((entity: unknown) => Promise.resolve(db.one.get(entity) ?? null));
    db.count.mockResolvedValue(0);
  });

  describe('loan repayments', () => {
    beforeEach(() => {
      db.many.set(Account, [account(1, { linked: true })]);
      db.many.set(Transaction, [transaction(123, 1)]);
    });

    it('attaches the repayment split of an active loan link, counting only active loans', async () => {
      db.many.set(LoanRepaymentLink, [loanLink(123, 9, 'Crédito habitação', { feeAmount: 8.83, interestAmount: 240, principalAmount: 238.4 })]);

      const page = await listTransactions(request());

      expect(page.transactions[0]).toMatchObject({
        loanRepayment: { feeAmount: 8.83, interestAmount: 240, loanKey: 9, loanKeys: [9], loanName: 'Crédito habitação', principalAmount: 238.4, spendingAmount: 248.83 },
      });
      const linkQuery = db.find.mock.calls.find(([entity]) => entity === LoanRepaymentLink);
      expect(linkQuery?.[1]).toMatchObject({ deletedAt: undefined, loanKey: { deletedAt: undefined } });
    });

    it('sums several links on one transaction, ordered by loan so the name is stable', async () => {
      db.many.set(LoanRepaymentLink, [
        loanLink(123, 12, 'Car loan', { feeAmount: 2, interestAmount: 20, principalAmount: 100 }),
        loanLink(123, 9, 'Mortgage', { feeAmount: 1, interestAmount: 30, principalAmount: 200 }),
      ]);

      const page = await listTransactions(request());

      expect(page.transactions[0]).toMatchObject({
        loanRepayment: { feeAmount: 3, interestAmount: 50, loanKey: 9, loanKeys: [9, 12], loanName: 'Mortgage | Car loan', principalAmount: 300, spendingAmount: 53 },
      });
    });

    it('leaves the split off a transaction with no active link', async () => {
      const page = await listTransactions(request());

      expect(page.transactions[0]).not.toHaveProperty('loanRepayment');
    });

    it('attaches the split on the single-account list too', async () => {
      db.one.set(Account, account(1, { linked: true }));
      db.many.set(LoanRepaymentLink, [loanLink(123, 9, 'Mortgage', { feeAmount: 1, interestAmount: 30, principalAmount: 200 })]);

      const page = await listTransactions(request({ scope: { accountKey: 1 } }));

      expect(page.transactions[0]).toMatchObject({ loanRepayment: { loanKey: 9 } });
    });
  });

  it('answers with the result envelope, counting the matching set once on the first page', async () => {
    db.many.set(Account, [account(1, { linked: true })]);
    db.many.set(Transaction, [transaction(123, 1)]);
    db.count.mockResolvedValue(8623);

    const page = await listTransactions(request());

    expect(page).toMatchObject({ hasMore: true, limit: 100, total: 8623 });
    expect(page).not.toHaveProperty('facets');
    expect(db.count).toHaveBeenCalledOnce();
  });

  it('marks transactions that belong to a recurring series and leaves the rest null', async () => {
    db.many.set(Account, [account(1, { linked: true })]);
    db.many.set(Transaction, [transaction(100, 1), transaction(101, 1)]);
    db.many.set(RecurringOccurrence, [
      {
        recurringSeriesKey: { amountType: 'fixed', displayName: 'Netflix', recurringSeriesKey: 77, status: 'confirmed', type: 'subscription' },
        transactionKey: { transactionKey: 100 },
      },
    ]);

    const page = await listTransactions(request());

    expect(page.transactions.map((row) => [row.transactionKey, row.recurringSeries?.recurringSeriesKey ?? null])).toEqual([
      [100, 77],
      [101, null],
    ]);
  });

  describe('opening-balance rows for offline accounts', () => {
    const openingBalanceAccounts = (page: Awaited<ReturnType<typeof listTransactions>>) =>
      page.transactions.filter((row) => row.description === 'Initial balance').map((row) => row.accountKey?.accountKey);

    /** Answers the per-account existence checks: these accounts have transactions, the rest none. Every other count is `total`. */
    function transactionsExistFor(accountKeys: number[], total = 0) {
      db.count.mockImplementation((_entity: unknown, where: { accountKey?: { accountKey?: number } }) => {
        const accountKey = where.accountKey?.accountKey;
        if (typeof accountKey === 'number') return Promise.resolve(accountKeys.includes(accountKey) ? 1 : 0);
        return Promise.resolve(total);
      });
    }

    function datedTransaction(transactionKey: number, accountKey: number, isoDate: string) {
      return { ...transaction(transactionKey, accountKey), transactionDate: new Date(isoDate) };
    }

    function accountCreated(accountKey: number, isoDate: string) {
      return { ...account(accountKey), createdAt: new Date(isoDate) };
    }

    it('adds one only for offline accounts with no transaction at all, and counts it', async () => {
      db.many.set(Account, [account(1), account(2), account(3, { linked: true })]);
      db.many.set(Transaction, [transaction(201, 1)]);
      transactionsExistFor([1], 1);

      const page = await listTransactions(request());

      expect(openingBalanceAccounts(page)).toEqual([2]);
      expect(page.total).toBe(2);
    });

    it('leaves out an offline account whose transactions are all further down the list', async () => {
      db.many.set(Account, [account(1), account(2)]);
      db.many.set(Transaction, [transaction(201, 1)]);
      transactionsExistFor([1, 2], 40);

      expect(openingBalanceAccounts(await listTransactions(request()))).toEqual([]);
    });

    it('sits at its date among the real rows, newest first, with a stable key', async () => {
      db.many.set(Account, [account(1, { linked: true }), accountCreated(2, '2026-02-15T00:00:00.000Z')]);
      db.many.set(Transaction, [datedTransaction(301, 1, '2026-03-01T00:00:00.000Z'), datedTransaction(300, 1, '2026-02-01T00:00:00.000Z')]);

      const page = await listTransactions(request());

      expect(page.transactions.map((row) => row.transactionKey)).toEqual([301, -2, 300]);
    });

    it('waits for the page its date falls on, and appears exactly once', async () => {
      db.many.set(Account, [account(1, { linked: true }), accountCreated(2, '2026-01-15T00:00:00.000Z')]);

      db.many.set(Transaction, [datedTransaction(301, 1, '2026-03-01T00:00:00.000Z'), datedTransaction(300, 1, '2026-02-01T00:00:00.000Z')]);
      transactionsExistFor([], 3);
      const first = await listTransactions(request({ limit: 2 }));
      expect(openingBalanceAccounts(first)).toEqual([]);
      expect(first).toMatchObject({ hasMore: true, total: 4 });

      db.many.set(Transaction, [datedTransaction(299, 1, '2026-01-01T00:00:00.000Z')]);
      const second = await listTransactions(request({ cursor: first.nextCursor ?? undefined, limit: 2 }));
      expect(second.transactions.map((row) => row.transactionKey)).toEqual([-2, 299]);
    });

    it('is left out when the date range excludes the day the account was created', async () => {
      db.many.set(Account, [accountCreated(2, '2026-01-15T00:00:00.000Z')]);

      const outside = await listTransactions(request({ filters: { fromDate: new Date('2026-02-01T00:00:00.000Z') } }));
      const inside = await listTransactions(request({ filters: { fromDate: new Date('2026-01-01T00:00:00.000Z'), toDate: new Date('2026-01-31T00:00:00.000Z') } }));

      expect(openingBalanceAccounts(outside)).toEqual([]);
      expect(openingBalanceAccounts(inside)).toEqual([2]);
    });

    it("carries the account's institution logo, so the row can show whose balance it is", async () => {
      db.many.set(Account, [account(1, { logoUrl: 'https://cdn.example/bank.png' }), account(2)]);

      const page = await listTransactions(request());
      const logos = page.transactions
        .filter((row) => row.description === 'Initial balance')
        .map((row) => [row.accountKey?.accountKey, row.accountKey?.accountFinancialInstitutionKey?.logoUrl ?? null]);

      expect(logos).toEqual([
        [1, 'https://cdn.example/bank.png'],
        [2, null],
      ]);
    });

    it('is not re-emitted on a page past its date, on either list', async () => {
      db.many.set(Account, [account(2)]);
      db.one.set(Account, account(2));

      for (const scope of ['all-accounts', { accountKey: 2 }] as const) {
        // The cursor sits at the account's creation instant, so its row belonged to an earlier page.
        const page = await listTransactions(request({ cursor: '1767225600000_5', scope }));

        expect(openingBalanceAccounts(page)).toEqual([]);
        expect(page.total).toBeNull();
      }
    });

    it('is excluded by the filters that would exclude a real row with its shape, on either list', async () => {
      db.many.set(Account, [account(2)]);
      db.one.set(Account, account(2));

      for (const scope of ['all-accounts', { accountKey: 2 }] as const) {
        for (const filters of [{ transactionTypes: ['debit'] }, { unreviewedOnly: true }, { categoryKeys: { includeUncategorized: false, keys: [4] } }]) {
          expect(openingBalanceAccounts(await listTransactions(request({ filters, scope })))).toEqual([]);
        }
        expect(openingBalanceAccounts(await listTransactions(request({ filters: { categoryKeys: { includeUncategorized: true, keys: [4] } }, scope })))).toEqual([2]);
      }
    });
  });

  it.each([
    ['all-accounts', undefined],
    ['all-accounts', { hidden: false }],
    [{ accountKey: 1 }, { hidden: false }],
  ] as const)('on the %j list, disables the hidden filter only when includeHidden is set (%j)', async (scope, expectedFilters) => {
    db.many.set(Account, [account(1, { linked: true })]);
    db.one.set(Account, account(1, { linked: true }));

    await listTransactions(request({ filters: { includeHidden: expectedFilters !== undefined }, scope }));

    expect(transactionFind()?.[2]?.filters).toEqual(expectedFilters);
  });

  it('rejects an account the viewer cannot see', async () => {
    await expect(listTransactions(request({ scope: { accountKey: 404 } }))).rejects.toThrow('Account not found');
  });

  it('answers an empty page when the viewer has no accounts', async () => {
    await expect(listTransactions(request())).resolves.toMatchObject({ hasMore: false, total: 0, transactions: [] });
    expect(transactionFind()).toBeUndefined();
  });
});
