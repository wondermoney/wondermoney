import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { Source, TransactionCategoryStats } from '@entity/TransactionCategoryStats';

const mocked = vi.hoisted(() => ({
  execute: vi.fn(),
  find: vi.fn(),
  findOne: vi.fn(),
  flush: vi.fn(),
  nativeUpdate: vi.fn(),
  persist: vi.fn().mockReturnThis(),
}));

vi.mock('@validators/parser', () => ({
  zParse: vi.fn((_schema, req: unknown) => Promise.resolve(req)),
}));

vi.mock('../../app.js', () => ({
  DI: {
    em: {
      execute: mocked.execute,
      find: mocked.find,
      findOne: mocked.findOne,
      flush: mocked.flush,
      nativeUpdate: mocked.nativeUpdate,
      persist: mocked.persist,
    },
  },
}));

import { mockReq, mockRes } from '../../__tests__/__helpers__/mock-request';
import { updateTransaction, updateTransactions } from '../account/transactions';

describe('account transaction update regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.persist.mockReturnThis();
  });

  it('updates transaction category without cloning MikroORM entities', async () => {
    const transaction = {
      appuserCurrencyKey: { code: 'EUR' },
      appuserTransactionCategories: { getItems: () => [{ categoryKey: { categoryKey: 26 } }] },
      balance: 100,
      settlementCurrencyKey: { code: 'EUR' },
      transactionKey: 1,
      transactionMerchantKey: null,
    };
    mocked.findOne.mockResolvedValueOnce(transaction).mockResolvedValueOnce({ categoryKey: 27, isSystemCategory: false, tenantKey: { tenantKey: 7 } });
    mocked.flush.mockResolvedValue(undefined);

    const json = vi.fn();
    const next = vi.fn();

    await updateTransaction(
      Object.assign(mockReq({ body: { categoryKey: 27 } }), { params: { transactionId: 1 }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ json }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.findOne).toHaveBeenNthCalledWith(2, Category, {
      $or: [
        { isSystemCategory: false, tenantKey: { tenantKey: 7 } },
        { isSystemCategory: true, tenantKey: null },
      ],
      categoryKey: 27,
      deletedAt: undefined,
    });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ transaction: expect.any(Object) }));
    // RAD-342.2: an explicit user categorization is always stamped high/user_edit confidence.
    expect(transaction).toMatchObject({ categorizationConfidence: 'high', categorizationReason: 'user_edit' });
  });

  it('accepts integer transaction ids in bulk updates', async () => {
    mocked.findOne.mockResolvedValueOnce({ appuserKey: 1, onboarding: {} });
    mocked.find.mockResolvedValueOnce([
      { appuserTransactionCategories: { getItems: () => [] }, reviewed: false, transactionKey: 1, transactionMerchantKey: null },
      { appuserTransactionCategories: { getItems: () => [] }, reviewed: false, transactionKey: 2, transactionMerchantKey: null },
    ]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { reviewed: true, transactionIds: [1, 2] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(mocked.find).toHaveBeenCalledWith(
      Transaction,
      { deletedAt: undefined, tenantKey: { tenantKey: 7 }, transactionKey: { $in: [1, 2] } },
      expect.objectContaining({ filters: { hidden: false } }),
    );
    expect(sendStatus).toHaveBeenCalledWith(200);
    // RAD-271: the reviewed flag is written with a single bulk UPDATE, not one persist/flush per row.
    expect(mocked.nativeUpdate).toHaveBeenCalledTimes(1);
    expect(mocked.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionKey: { $in: [1, 2] } }),
      { reviewed: true },
    );
    expect(mocked.persist).not.toHaveBeenCalled();
  });

  it('rejects mixed transaction ids before category lookup or any writes', async () => {
    mocked.findOne.mockResolvedValueOnce({ appuserKey: 1, onboarding: {} });
    mocked.find.mockResolvedValueOnce([{ appuserTransactionCategories: { getItems: () => [] }, transactionKey: 1, transactionMerchantKey: null }]);
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1, 2] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Transaction not found' }));
    expect(mocked.findOne).toHaveBeenCalledTimes(1);
    expect(mocked.persist).not.toHaveBeenCalled();
    expect(mocked.nativeUpdate).not.toHaveBeenCalled();
    expect(mocked.execute).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized category before assignment, stats, learning, or audit writes', async () => {
    mocked.findOne.mockResolvedValueOnce({ appuserKey: 1, onboarding: {} }).mockResolvedValueOnce(null);
    mocked.find.mockResolvedValueOnce([{ appuserTransactionCategories: { getItems: () => [] }, transactionKey: 1, transactionMerchantKey: { transactionMerchantKey: 5 } }]);
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Category not found' }));
    expect(mocked.findOne).toHaveBeenNthCalledWith(2, Category, {
      $or: [
        { isSystemCategory: false, tenantKey: { tenantKey: 7 } },
        { isSystemCategory: true, tenantKey: null },
      ],
      categoryKey: 27,
      deletedAt: undefined,
    });
    expect(mocked.persist).not.toHaveBeenCalled();
    expect(mocked.nativeUpdate).not.toHaveBeenCalled();
    expect(mocked.execute).not.toHaveBeenCalled();
  });

  // RAD-267: bulk category assignment used to unconditionally write a TransactionCategoryStats row keyed by
  // transaction.transactionMerchantKey, which is nullable on Transaction. Categorizing a transaction with no
  // resolved merchant produced a `transactionMerchantKey` FK that was null/undefined, and MikroORM's
  // EntityValidator threw on flush ("Value for TransactionCategoryStats.transactionMerchantKey is required").
  it('categorizes a transaction with no resolved merchant without writing merchant category stats (RAD-267)', async () => {
    mocked.findOne
      .mockResolvedValueOnce({ appuserKey: 1, onboarding: {} }) // Appuser lookup
      .mockResolvedValueOnce({ categoryKey: 27, isSystemCategory: false, tenantKey: { tenantKey: 7 } }); // Category lookup
    mocked.find.mockResolvedValueOnce([
      { appuserTransactionCategories: { getItems: () => [] }, reviewed: false, transactionKey: 1, transactionMerchantKey: null },
    ]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mocked.findOne).toHaveBeenNthCalledWith(2, Category, {
      $or: [
        { isSystemCategory: false, tenantKey: { tenantKey: 7 } },
        { isSystemCategory: true, tenantKey: null },
      ],
      categoryKey: 27,
      deletedAt: undefined,
    });
    // No TransactionCategoryStats lookup/creation should have been attempted for a merchant-less transaction.
    // (3rd findOne is the RAD-425 closed-loop enrichment-outcome lookup, which always runs on a category set.)
    expect(mocked.findOne).toHaveBeenCalledTimes(3);
    expect(mocked.persist.mock.calls.some(([entity]) => entity instanceof TransactionCategoryStats)).toBe(false);
  });

  // API-QB: the merchant→category vote is now written with a single atomic INSERT ... ON CONFLICT
  // DO UPDATE (via em.execute) instead of a check-then-insert (findOne → new TransactionCategoryStats
  // → persist), which used to race on the unique constraint under concurrent/double-submitted edits.
  it('records merchant category stats via an atomic upsert in bulk updates when a merchant is resolved', async () => {
    const merchant = { transactionMerchantKey: 5 };
    mocked.findOne
      .mockResolvedValueOnce({ appuserKey: 1, onboarding: {} }) // Appuser lookup
      .mockResolvedValueOnce({ categoryKey: 27, isSystemCategory: true, tenantKey: null }); // Category lookup
    mocked.find.mockResolvedValueOnce([
      { appuserTransactionCategories: { getItems: () => [] }, reviewed: false, transactionKey: 1, transactionMerchantKey: merchant },
    ]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mocked.findOne).toHaveBeenNthCalledWith(2, Category, {
      $or: [
        { isSystemCategory: false, tenantKey: { tenantKey: 7 } },
        { isSystemCategory: true, tenantKey: null },
      ],
      categoryKey: 27,
      deletedAt: undefined,
    });
    // No entity-level create of a TransactionCategoryStats — the write is a raw atomic upsert.
    const persistedEntities: unknown[] = mocked.persist.mock.calls.map(([entity]: unknown[]) => entity);
    expect(persistedEntities.some((entity) => entity instanceof TransactionCategoryStats)).toBe(false);
    // RAD-411: the actual category assignment IS now persisted (an AppuserTransactionCategory), not just the stat.
    expect(persistedEntities.some((entity) => entity instanceof AppuserTransactionCategory)).toBe(true);
    // Three atomic upserts via em.execute: the merchant stat (call 0), plus the per-user mapping learn (retire + upsert).
    expect(mocked.execute).toHaveBeenCalledTimes(3);
    const [statsSql, statsParams] = mocked.execute.mock.calls[0] as [string, unknown[]];
    // RAD-342 G4: the vote is scoped per user — conflict target and params carry appuser_key.
    expect(statsSql.toLowerCase()).toContain('on conflict ("transaction_merchant_key", "category_key", "source", "appuser_key")');
    expect(statsParams).toEqual([5, 27, 1, Source.USER]); // [merchantKey, categoryKey, appuserKey, source]
    const learnUpsert = (mocked.execute.mock.calls as [string, unknown[]][]).find(([sql]) =>
      sql.toLowerCase().includes('into "appuser_merchant_category"'),
    );
    expect(learnUpsert).toBeDefined();
    expect(learnUpsert![1]).toEqual([1, 5, 27]); // [appuserKey, merchantKey, categoryKey]
  });

  // RAD-411: bulk categorize used to move the stat counters + write a CATEGORIZED audit row but never persist
  // the AppuserTransactionCategory, so the displayed category never changed. These two guard the actual assignment.
  it('persists a new AppuserTransactionCategory in bulk when the transaction had no category (RAD-411)', async () => {
    mocked.findOne
      .mockResolvedValueOnce({ appuserKey: 1, onboarding: {} }) // Appuser lookup
      .mockResolvedValueOnce({ categoryKey: 27 }); // Category lookup
    const transaction = { appuserTransactionCategories: { getItems: () => [] }, reviewed: false, transactionKey: 1, transactionMerchantKey: null };
    mocked.find.mockResolvedValueOnce([transaction]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    const persisted: unknown[] = mocked.persist.mock.calls.map(([entity]: unknown[]) => entity);
    const assignment = persisted.find((entity): entity is AppuserTransactionCategory => entity instanceof AppuserTransactionCategory);
    expect(assignment).toBeDefined();
    expect(assignment!.categoryKey).toEqual({ categoryKey: 27 });
    expect(assignment!.source).toBe(Source.USER);
    // RAD-342.2: bulk categorization is an explicit user action — stamp high/user_edit confidence.
    expect(transaction).toMatchObject({ categorizationConfidence: 'high', categorizationReason: 'user_edit' });
  });

  it('updates the existing AppuserTransactionCategory in bulk when the transaction already had a category (RAD-411)', async () => {
    const existingAssignment = { categoryKey: { categoryKey: 26 } };
    mocked.findOne
      .mockResolvedValueOnce({ appuserKey: 1, onboarding: {} }) // Appuser lookup
      .mockResolvedValueOnce({ categoryKey: 27 }); // Category lookup
    const transaction = { appuserTransactionCategories: { getItems: () => [existingAssignment] }, reviewed: false, transactionKey: 1, transactionMerchantKey: null };
    mocked.find.mockResolvedValueOnce([transaction]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { categoryId: 27, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    // The existing row's category is mutated to the new one (not a second assignment created).
    expect(existingAssignment.categoryKey).toEqual({ categoryKey: 27 });
    expect(mocked.persist).toHaveBeenCalledWith(existingAssignment);
    // RAD-342.2: bulk categorization is an explicit user action — stamp high/user_edit confidence.
    expect(transaction).toMatchObject({ categorizationConfidence: 'high', categorizationReason: 'user_edit' });
  });

  it('sets hidden independently of reviewed in the bulk nativeUpdate payload (RAD-25)', async () => {
    mocked.findOne.mockResolvedValueOnce({ appuserKey: 1, onboarding: {} });
    mocked.find.mockResolvedValueOnce([
      { appuserTransactionCategories: { getItems: () => [] }, hidden: false, reviewed: true, transactionKey: 1, transactionMerchantKey: null },
    ]);
    mocked.flush.mockResolvedValue(undefined);

    const sendStatus = vi.fn();
    const next = vi.fn();

    await updateTransactions(
      { body: { hidden: true, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sendStatus).toHaveBeenCalledWith(200);
    // RAD-25: hiding must not silently reset `reviewed` when the caller only intends to change `hidden` —
    // the old unconditional `{ reviewed: !!reviewed || !!category }` payload would have reset it to false here.
    expect(mocked.nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionKey: { $in: [1] } }),
      { hidden: true },
    );
  });

  it('disables the hidden filter when loading transactions for a bulk update, so already-hidden rows can be unhidden (RAD-25)', async () => {
    mocked.findOne.mockResolvedValueOnce({ appuserKey: 1, onboarding: {} });
    mocked.find.mockResolvedValueOnce([
      { appuserTransactionCategories: { getItems: () => [] }, hidden: true, reviewed: false, transactionKey: 1, transactionMerchantKey: null },
    ]);
    mocked.flush.mockResolvedValue(undefined);

    await updateTransactions(
      { body: { hidden: false, transactionIds: [1] }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } } as Parameters<typeof updateTransactions>[0],
      mockRes({ sendStatus: vi.fn() }),
      vi.fn(),
    );

    expect(mocked.find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionKey: { $in: [1] } }),
      expect.objectContaining({ filters: { hidden: false } }),
    );
  });

  it('closes the loop: stamps the AI enrichment outcome when a user recategorizes a transaction (RAD-425)', async () => {
    const transaction = {
      appuserCurrencyKey: { code: 'EUR' },
      appuserTransactionCategories: { getItems: () => [{ categoryKey: { categoryKey: 12 } }] },
      balance: 100,
      settlementCurrencyKey: { code: 'EUR' },
      transactionKey: 1,
      transactionMerchantKey: null,
    };
    const enrichmentRow: { categorySuggestionKey: { categoryKey: number }; outcome?: string } = {
      categorySuggestionKey: { categoryKey: 12 },
      outcome: undefined,
    };
    mocked.findOne
      .mockResolvedValueOnce(transaction) // transaction lookup
      .mockResolvedValueOnce({ categoryKey: 27 }) // category lookup
      .mockResolvedValueOnce(enrichmentRow); // stampTransactionEnrichmentOutcome lookup
    mocked.flush.mockResolvedValue(undefined);

    const json = vi.fn();
    const next = vi.fn();

    await updateTransaction(
      Object.assign(mockReq({ body: { categoryKey: 27 } }), { params: { transactionId: 1 }, tenant: { tenantKey: 7 }, user: { appuserKey: 1 } }),
      mockRes({ json }),
      next,
    );

    expect(next).not.toHaveBeenCalled();
    // The user picked a different category (27) than the AI had suggested (12): an override.
    expect(enrichmentRow.outcome).toBe('overridden');
  });
});
