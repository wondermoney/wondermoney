import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';

import { Appuser } from '@entity/Appuser';
import { AppuserTransactionCategory } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';

const stats = vi.hoisted(() => ({
  decrement: vi.fn(),
  increment: vi.fn(),
  learn: vi.fn(),
  stamp: vi.fn(),
}));

vi.mock('@service/transaction/merchant-category-stats.service', () => ({
  decrementMerchantCategoryStat: stats.decrement,
  incrementMerchantCategoryStat: stats.increment,
  learnAppuserMerchantCategory: stats.learn,
}));

vi.mock('@service/transaction-enrichment/transaction-enrichment-outcome.service', () => ({
  stampTransactionEnrichmentOutcome: stats.stamp,
}));

import { applyUserCategorization } from '../user-categorization.service';

function category(categoryKey: number): Category {
  return Object.assign(new Category(), { categoryKey });
}

/** A transaction whose category collection is backed by a plain array — no ORM metadata needed. */
function transaction(transactionKey: number, opts: { current?: Category; merchant?: TransactionMerchant } = {}): Transaction {
  const tx = Object.assign(new Transaction(), { transactionKey, transactionMerchantKey: opts.merchant });
  const items: AppuserTransactionCategory[] = [];
  if (opts.current) items.push(Object.assign(new AppuserTransactionCategory(), { categoryKey: opts.current, transactionKey: tx }));
  vi.spyOn(tx.appuserTransactionCategories, 'getItems').mockImplementation(() => items);
  return tx;
}

const em = mockDeep<EntityManager>();
const actor = Object.assign(new Appuser(), { appuserKey: 8 });
const merchant = Object.assign(new TransactionMerchant(), { transactionMerchantKey: 3 });

describe('applyUserCategorization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves an existing assignment and creates a missing one, stamping user-edit confidence on both', async () => {
    const groceries = category(10);
    const dining = category(20);
    const recategorized = transaction(1, { current: groceries });
    const uncategorized = transaction(2);

    const previous = await applyUserCategorization(em, { actor, category: dining, transactions: [recategorized, uncategorized] });

    expect(previous).toEqual(new Map([[1, groceries], [2, undefined]]));
    expect(recategorized.appuserTransactionCategories.getItems().map((a) => a.categoryKey)).toEqual([dining]);
    const persisted = em.persist.mock.calls.map(([entity]) => entity);
    expect(persisted).toContainEqual(expect.objectContaining({ appuserKey: actor, categoryKey: dining, source: 'user', transactionKey: uncategorized }));
    for (const tx of [recategorized, uncategorized]) {
      expect(tx).toMatchObject({ categorizationConfidence: 'high', categorizationReason: 'user_edit' });
    }
  });

  it('moves the actor\'s merchant vote from the previous category to the new one', async () => {
    const groceries = category(10);
    const dining = category(20);

    await applyUserCategorization(em, { actor, category: dining, transactions: [transaction(1, { current: groceries, merchant })] });

    expect(stats.decrement).toHaveBeenCalledWith(em, merchant, groceries, actor);
    expect(stats.increment).toHaveBeenCalledWith(em, merchant, dining, actor);
    expect(stats.learn).toHaveBeenCalledWith(em, actor, merchant, dining);
  });

  it('only adds a vote when there was no previous category, and none at all without a merchant', async () => {
    await applyUserCategorization(em, { actor, category: category(20), transactions: [transaction(1, { merchant }), transaction(2)] });

    expect(stats.decrement).not.toHaveBeenCalled();
    expect(stats.increment).toHaveBeenCalledOnce();
    expect(stats.learn).toHaveBeenCalledOnce();
  });

  it('reports the choice against any outstanding AI suggestion for every transaction', async () => {
    await applyUserCategorization(em, { actor, category: category(20), transactions: [transaction(1), transaction(2)] });

    expect(stats.stamp.mock.calls.map((call: unknown[]) => call.slice(1))).toEqual([[1, 20], [2, 20]]);
  });
});
