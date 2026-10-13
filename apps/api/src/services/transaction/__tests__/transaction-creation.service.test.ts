import { QueryOrder } from '@mikro-orm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { Transaction } from '@entity/Transaction';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  getRepository: vi.fn(),
  incrementMerchantCategoryStat: vi.fn(),
  learnAppuserMerchantCategory: vi.fn(),
  persist: vi.fn().mockReturnThis(),
  resolveMerchant: vi.fn(),
  triggerRecurringDetectionAfterTransactionIngestion: vi.fn(),
}));

vi.mock('@app/app', () => ({
  DI: {
    em: {
      count: mocks.count,
      find: mocks.find,
      findOne: mocks.findOne,
      flush: mocks.flush,
      getRepository: mocks.getRepository,
      persist: mocks.persist,
    },
  },
}));

vi.mock('@service/recurring/post-transaction-ingestion-detection.service', () => ({
  triggerRecurringDetectionAfterTransactionIngestion: mocks.triggerRecurringDetectionAfterTransactionIngestion,
}));

vi.mock('@service/transaction/transaction-merchant.service', () => ({
  transactionMerchantService: {
    resolveMerchant: mocks.resolveMerchant,
  },
}));

vi.mock('@service/transaction/merchant-category-stats.service', () => ({
  incrementMerchantCategoryStat: mocks.incrementMerchantCategoryStat,
  learnAppuserMerchantCategory: mocks.learnAppuserMerchantCategory,
}));

import { transactionCreationService } from '../transaction-creation.service';

function resetMocks() {
  vi.clearAllMocks();
  mocks.count.mockReset();
  mocks.find.mockReset();
  // The balance chain always looks for later transactions; default to "there are none".
  mocks.find.mockResolvedValue([]);
  mocks.findOne.mockReset();
  mocks.flush.mockReset();
  mocks.persist.mockReset();
  mocks.persist.mockReturnThis();
  mocks.resolveMerchant.mockReset();
}

describe('transaction creation service security checks', () => {
  beforeEach(resetMocks);

  it('scopes account lookup by current user ownership', async () => {
    const appuser = { appuserKey: 7, currencyKey: { currencyKey: 1 } };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'card_payment', transactionTypeKey: 1 })
      .mockResolvedValueOnce(null);

    await expect(
      transactionCreationService.createTransaction({
        accountId: 999,
        appuserKey: 7,
        settlementAmount: 10,
        settlementCurrencyId: 1,
        transactionDate: new Date('2026-01-01'),
        transactionMerchantName: 'Store',
        transactionTypeId: 1,
      }),
    ).rejects.toThrow('Account not found');

    const accountLookup = mocks.findOne.mock.calls.find((call) => call[0] === Account);
    expect(accountLookup?.[1]).toMatchObject({
      accountKey: 999,
      accountOwnerAppuserKey: appuser,
      deletedAt: undefined,
    });
  });

  it('resolves the category against the household, not the member who created it, and skips deleted ones', async () => {
    // A partner (appuserKey 8) picks a category the household owner created. Categories are
    // household-shared, so the lookup must be tenant-scoped; an appuser-scoped lookup 404s here.
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 8, currencyKey: currency };
    const tenant = { tenantKey: 1 };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: tenant }),
    });
    const rows = new Map<unknown, unknown>([
      [Account, { accountKey: 5, balance: 0, currencyKey: currency }],
      [Appuser, appuser],
      [Currency, currency],
      [TransactionType, { name: 'card_payment', transactionTypeKey: 1 }],
    ]);
    mocks.findOne.mockImplementation((entity: unknown) => Promise.resolve(rows.get(entity) ?? null));

    await expect(
      transactionCreationService.createTransaction({
        accountId: 5,
        appuserKey: 8,
        categoryId: 42,
        settlementAmount: 10,
        settlementCurrencyId: 1,
        transactionDate: new Date('2026-01-01'),
        transactionTypeId: 1,
      }),
    ).rejects.toThrow('Category not found');

    const categoryLookup = mocks.findOne.mock.calls.find((call) => call[0] === Category);
    expect(categoryLookup?.[1]).toEqual({
      $or: [
        { isSystemCategory: false, tenantKey: tenant },
        { isSystemCategory: true, tenantKey: null },
      ],
      categoryKey: 42,
      deletedAt: undefined,
    });
  });

  it('resolves merchant by tenant and normalized name', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const tenant = { tenantKey: 99 };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      balance: 100,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: tenant,
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: tenant }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 });
    mocks.count.mockResolvedValueOnce(0);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Coffee Shop', transactionMerchantKey: 5 });

    await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-10T00:00:00.000Z'),
      transactionMerchantName: '  Coffee   Shop ',
      transactionTypeId: 1,
    });

    expect(mocks.resolveMerchant).toHaveBeenCalledWith({
      tenant,
      transactionMerchantId: undefined,
      transactionMerchantName: '  Coffee   Shop ',
    });
    expect(normalizeMerchantName('  Coffee   Shop ')).toBe('coffee shop');
  });

  it('preserves initial balance and materializes appuser currency balance for first transaction on non-empty account state', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      appuserCurrencyBalance: 1000,
      balance: 1000,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 1 },
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 });
    mocks.count.mockResolvedValueOnce(0);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Store', transactionMerchantKey: 5 });

    const created = await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-10T00:00:00.000Z'),
      transactionMerchantName: 'Store',
      transactionTypeId: 1,
    });

    expect(created.balance).toBe(1050);
    expect(created.appuserCurrencyBalance).toBe(1050);
    expect(account.balance).toBe(1050);
    expect(account.appuserCurrencyBalance).toBe(1050);
  });

  it('preserves a manual opening balance for the first transaction on the same day', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      appuserCurrencyBalance: 1000,
      balance: 1000,
      // The transaction is midnight on the account creation day, before this
      // timestamp. It must still be added to the manually entered balance.
      createdAt: new Date('2026-01-10T12:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 1 },
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 });
    mocks.count.mockResolvedValueOnce(0);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Store', transactionMerchantKey: 5 });

    const created = await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-10T00:00:00.000Z'),
      transactionMerchantName: 'Store',
      transactionTypeId: 1,
    });

    expect(created.balance).toBe(1050);
    expect(created.appuserCurrencyBalance).toBe(1050);
    expect(account.balance).toBe(1050);
  });

  it('materializes appuser currency balance when recalculating future transactions', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      appuserCurrencyBalance: 250,
      balance: 250,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 1 },
    };
    const futureTransaction = {
      appuserCurrencyBalance: 250,
      appuserSettlementAmount: 200,
      balance: 250,
      settlementAmount: 200,
      transactionDate: new Date('2026-01-03T00:00:00.000Z'),
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(futureTransaction);
    mocks.count.mockResolvedValueOnce(1);
    mocks.find.mockResolvedValueOnce([futureTransaction]);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Store', transactionMerchantKey: 5 });

    const created = await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-02T00:00:00.000Z'),
      transactionMerchantName: 'Store',
      transactionTypeId: 1,
    });

    expect(created.balance).toBe(100);
    expect(created.appuserCurrencyBalance).toBe(100);
    expect(futureTransaction.balance).toBe(300);
    expect(futureTransaction.appuserCurrencyBalance).toBe(300);
    expect(account.balance).toBe(300);
    expect(account.appuserCurrencyBalance).toBe(300);
  });

  it('includes hidden transactions when recalculating future balances (RAD-25)', async () => {
    // A hidden transaction still moved money, so balance recomputation must see it — the future-balance
    // load must disable the hidden filter or the stored balance chain would drift.
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      appuserCurrencyBalance: 250,
      balance: 250,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 1 },
    };
    const futureTransaction = {
      appuserCurrencyBalance: 250,
      appuserSettlementAmount: 200,
      balance: 250,
      settlementAmount: 200,
      transactionDate: new Date('2026-01-03T00:00:00.000Z'),
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(futureTransaction);
    mocks.count.mockResolvedValueOnce(1);
    mocks.find.mockResolvedValueOnce([futureTransaction]);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Store', transactionMerchantKey: 5 });

    await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-02T00:00:00.000Z'),
      transactionMerchantName: 'Store',
      transactionTypeId: 1,
    });

    const [, , opts] = mocks.find.mock.calls[0]!;
    expect((opts as { filters?: unknown }).filters).toEqual({ hidden: false });
  });

  it('treats FEE transactions as outgoing when calculating balances', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      appuserCurrencyBalance: 100,
      balance: 100,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 1 },
    };

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'FEE', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 });
    mocks.count.mockResolvedValueOnce(0);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Bank Fee', transactionMerchantKey: 5 });

    const created = await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 5,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-10T00:00:00.000Z'),
      transactionMerchantName: 'Bank Fee',
      transactionTypeId: 1,
    });

    expect(created.settlementAmount).toBe(-5);
    expect(created.appuserSettlementAmount).toBe(-5);
    expect(created.balance).toBe(95);
    expect(account.balance).toBe(95);
  });

  it('triggers recurring detection after successful transaction persistence', async () => {
    const currency = { code: 'EUR', currencyKey: 1 };
    const appuser = { appuserKey: 7, currencyKey: currency };
    const account = {
      accountKey: 10,
      accountOwnerAppuserKey: appuser,
      balance: 100,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      currencyKey: { currencyKey: 1 },
      tenantKey: { tenantKey: 42 },
    };
    const tenant = { tenantKey: 42 };
    const persistDeferred = Promise.resolve();

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: tenant }),
    });
    mocks.findOne
      .mockResolvedValueOnce(appuser)
      .mockResolvedValueOnce({ name: 'credit', transactionTypeKey: 1 })
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(currency)
      .mockResolvedValueOnce({ name: 'BOOKED', transactionStatusKey: 1 });
    mocks.count.mockResolvedValueOnce(0);
    mocks.flush.mockResolvedValueOnce(persistDeferred);
    mocks.resolveMerchant.mockResolvedValueOnce({ name: 'Store', transactionMerchantKey: 5 });

    const created = await transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      settlementAmount: 50,
      settlementCurrencyId: 1,
      transactionDate: new Date('2026-01-10T00:00:00.000Z'),
      transactionMerchantName: 'Store',
      transactionTypeId: 1,
    });

    expect(created).toBeDefined();
    expect(created.tenantKey).toBe(tenant);
    expect(mocks.triggerRecurringDetectionAfterTransactionIngestion).toHaveBeenCalledWith(42, 'manual-transaction');
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.triggerRecurringDetectionAfterTransactionIngestion.mock.invocationCallOrder[0]!).toBeGreaterThan(
      mocks.persist.mock.invocationCallOrder[0]!,
    );
  });
});

/**
 * RAD-546 — running balance chain. These tests run the service against an in-memory stand-in for the
 * EntityManager so a whole sequence of creates shares state, which is what the bug needed: the third
 * and later back-dated transactions restarted the running balance from zero instead of continuing
 * from the account's opening balance.
 */
describe('running balance chain (RAD-546)', () => {
  const OPENING_BALANCE = 1000;
  const ACCOUNT_CREATED_AT = new Date('2026-08-20T17:00:00.000Z');
  const CREDIT_TYPE = 1;
  const CARD_PAYMENT_TYPE = 2;
  const TRANSACTION_TYPE_NAMES: Record<number, string> = {
    [CARD_PAYMENT_TYPE]: 'card_payment',
    [CREDIT_TYPE]: 'credit',
  };

  /** Every entry is back-dated: months before the account row was created. */
  const BACK_DATED = [
    { amount: 2650, date: '2026-05-01T11:00:00.000Z', typeId: CREDIT_TYPE },
    { amount: 883.75, date: '2026-05-03T11:00:00.000Z', typeId: CARD_PAYMENT_TYPE },
    { amount: 124.55, date: '2026-05-04T11:00:00.000Z', typeId: CARD_PAYMENT_TYPE },
    { amount: 63.65, date: '2026-05-07T11:00:00.000Z', typeId: CARD_PAYMENT_TYPE },
    { amount: 54.75, date: '2026-05-09T11:00:00.000Z', typeId: CARD_PAYMENT_TYPE },
    { amount: 8.06, date: '2026-05-11T11:00:00.000Z', typeId: CARD_PAYMENT_TYPE },
  ];
  const SIGNED_AMOUNTS = [2650, -883.75, -124.55, -63.65, -54.75, -8.06];

  const currency = { code: 'EUR', currencyKey: 1 };
  const appuser = { appuserKey: 7, currencyKey: currency };

  /** The subset of the service's `where` clauses the in-memory EntityManager has to understand. */
  interface FakeQuery {
    categoryKey?: number;
    transactionDate?: { $gt?: Date; $lte?: Date };
    transactionTypeKey?: number;
  }

  let account: { appuserCurrencyBalance: number; balance: number; createdAt: Date };
  let stored: Transaction[];
  let nextTransactionKey: number;

  /** The account's transactions in the total order the list endpoint renders: date, then key. */
  function orderedChain(): Transaction[] {
    return [...stored].sort(
      (a, b) => a.transactionDate!.getTime() - b.transactionDate!.getTime() || a.transactionKey - b.transactionKey,
    );
  }

  function selectTransactions(where: FakeQuery): Transaction[] {
    const range = where.transactionDate ?? {};
    return orderedChain().filter(
      (transaction) =>
        (range.$lte === undefined || transaction.transactionDate!.getTime() <= range.$lte.getTime()) &&
        (range.$gt === undefined || transaction.transactionDate!.getTime() > range.$gt.getTime()),
    );
  }

  async function addTransaction(entry: { amount: number; categoryId?: number; date: string; typeId: number }) {
    return transactionCreationService.createTransaction({
      accountId: 10,
      appuserKey: 7,
      categoryId: entry.categoryId,
      settlementAmount: entry.amount,
      settlementCurrencyId: 1,
      transactionDate: new Date(entry.date),
      transactionMerchantName: 'Store',
      transactionTypeId: entry.typeId,
    });
  }

  beforeEach(() => {
    resetMocks();
    account = { appuserCurrencyBalance: OPENING_BALANCE, balance: OPENING_BALANCE, createdAt: ACCOUNT_CREATED_AT };
    stored = [];
    nextTransactionKey = 1;

    mocks.getRepository.mockReturnValue({
      getAppuserTenantByAppuser: vi.fn().mockResolvedValue({ appuserKey: appuser, tenantKey: { tenantKey: 1 } }),
    });
    mocks.resolveMerchant.mockResolvedValue({ name: 'Store', transactionMerchantKey: 5 });

    mocks.findOne.mockImplementation(
      (entity: unknown, where: FakeQuery, options?: { orderBy?: { transactionDate?: string } }) => {
        if (entity === Appuser) return appuser;
        if (entity === Account) return account;
        if (entity === Currency) return currency;
        if (entity === TransactionStatus) return { name: 'BOOKED', transactionStatusKey: 1 };
        if (entity === Category) return { categoryKey: where.categoryKey, isSystemCategory: true };
        if (entity === TransactionType) {
          const transactionTypeKey = where.transactionTypeKey!;
          return { name: TRANSACTION_TYPE_NAMES[transactionTypeKey], transactionTypeKey };
        }
        if (entity === Transaction) {
          const matches = selectTransactions(where);
          return (options?.orderBy?.transactionDate === QueryOrder.DESC ? matches.at(-1) : matches[0]) ?? null;
        }
        return null;
      },
    );

    mocks.find.mockImplementation((entity: unknown, where: FakeQuery) =>
      entity === Transaction ? selectTransactions(where) : [],
    );
    mocks.count.mockImplementation((entity: unknown, where: FakeQuery) =>
      entity === Transaction ? selectTransactions(where).length : 0,
    );

    const pending: unknown[] = [];
    mocks.persist.mockImplementation((entity: unknown) => {
      pending.push(entity);
      return mocks;
    });
    mocks.flush.mockImplementation(() => {
      for (const entity of pending.splice(0)) {
        // MikroORM cascade-persists the many-to-one target of a link entity, so persisting a
        // category link also inserts the transaction it points at — that cascade is what let a
        // still-unbalanced transaction reach the database mid-create.
        const inserted = entity instanceof AppuserTransactionCategory ? entity.transactionKey : entity;
        if (inserted instanceof Transaction && !stored.includes(inserted)) {
          inserted.transactionKey = nextTransactionKey++;
          stored.push(inserted);
        }
      }
    });
  });

  it.each([
    ['ascending', [0, 1, 2, 3, 4, 5]],
    ['descending', [5, 4, 3, 2, 1, 0]],
    ['shuffled', [3, 0, 5, 1, 4, 2]],
  ] as const)(
    'accumulates every back-dated transaction from the opening balance when inserted in %s order',
    async (_label, insertionOrder) => {
      for (const index of insertionOrder) {
        await addTransaction(BACK_DATED[index]!);
      }

      const chain = orderedChain();
      expect(chain).toHaveLength(BACK_DATED.length);
      expect(chain.map((transaction) => transaction.settlementAmount)).toEqual(SIGNED_AMOUNTS);

      let running = OPENING_BALANCE;
      for (const [index, transaction] of chain.entries()) {
        running += SIGNED_AMOUNTS[index]!;
        expect(transaction.balance).toBeCloseTo(running, 10);
        expect(transaction.appuserCurrencyBalance).toBeCloseTo(running, 10);
      }

      expect(account.balance).toBeCloseTo(running, 10);
      expect(account.appuserCurrencyBalance).toBeCloseTo(running, 10);
    },
  );

  it('keeps the third back-dated transaction on the chain instead of restarting it from zero', async () => {
    for (const entry of BACK_DATED.slice(0, 3)) {
      await addTransaction(entry);
    }

    const third = orderedChain()[2]!;
    expect(third.balance).not.toBe(third.settlementAmount);
    expect(third.balance).toBeCloseTo(OPENING_BALANCE + 2650 - 883.75 - 124.55, 10);
  });

  it('does not write the transaction before its balance is computed when a category is assigned', async () => {
    await addTransaction(BACK_DATED[0]!);
    mocks.persist.mockClear();

    const categorized = await addTransaction({ ...BACK_DATED[1]!, categoryId: 3 });

    // Persisting the category link cascade-inserts the transaction it points at. Doing that before
    // the balance is computed made the chain lookup find the new row — balance still null — as its
    // own predecessor, so the running balance restarted from the transaction's own amount.
    expect(mocks.persist.mock.calls[0]![0]).toBeInstanceOf(Transaction);
    expect(categorized.balance).toBeCloseTo(OPENING_BALANCE + 2650 - 883.75, 10);
  });

  it('recalculates later transactions when one is inserted into the middle of the chain', async () => {
    await addTransaction(BACK_DATED[0]!);
    await addTransaction(BACK_DATED[2]!);
    await addTransaction(BACK_DATED[1]!);

    const chain = orderedChain();
    expect(chain.map((transaction) => transaction.balance?.toFixed(2))).toEqual(['3650.00', '2766.25', '2641.70']);
    expect(account.balance).toBeCloseTo(2641.7, 10);
  });
});
