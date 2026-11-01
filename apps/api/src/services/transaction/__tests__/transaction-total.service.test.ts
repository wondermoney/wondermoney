import { describe, expect, it } from 'vitest';

import { CategorizationConfidence } from '@entity/Transaction';
import { buildTransactionWhere } from '@service/transaction/transaction-total.service';

/**
 * Account, type and category filters are applied by the endpoint, not client-side over the rows
 * already loaded — otherwise filtering a year by one category would filter whichever page came
 * back. These assert the `where` the server builds; the *counts* they produce were verified
 * against real data rather than inferred from the shape.
 */
describe('buildTransactionWhere', () => {
  it('applies no filter clauses when nothing is selected', () => {
    const where = buildTransactionWhere({}) as Record<string, unknown>;

    expect(where['accountKey']).toEqual({ deletedAt: undefined });
    expect(where['transactionTypeKey']).toBeUndefined();
    expect(where['$or']).toBeUndefined();
    expect(where['appuserTransactionCategories']).toBeUndefined();
  });

  it('scopes to the selected accounts without dropping the deleted-account guard', () => {
    const where = buildTransactionWhere({ accountKeys: [4, 9] }) as Record<string, unknown>;

    // The guard has to survive: filtering by account must never surface a deleted one.
    expect(where['accountKey']).toEqual({ accountKey: { $in: [4, 9] }, deletedAt: undefined });
  });

  it('filters on transaction type names', () => {
    const where = buildTransactionWhere({ transactionTypes: ['CARD_PAYMENT', 'TRANSFER_IN'] }) as Record<string, unknown>;

    expect(where['transactionTypeKey']).toEqual({ name: { $in: ['CARD_PAYMENT', 'TRANSFER_IN'] } });
  });

  it('treats an empty selection as no filter rather than as a filter matching nothing', () => {
    const where = buildTransactionWhere({
      accountKeys: [],
      categoryKeys: { includeUncategorized: false, keys: [] },
      transactionTypes: [],
    }) as Record<string, unknown>;

    expect(where['accountKey']).toEqual({ deletedAt: undefined });
    expect(where['transactionTypeKey']).toBeUndefined();
    expect(where['$or']).toBeUndefined();
    expect(where['appuserTransactionCategories']).toBeUndefined();
  });

  describe('category filter', () => {
    it('matches named categories with $some, not the implicit collection form', () => {
      const where = buildTransactionWhere({
        categoryKeys: { includeUncategorized: false, keys: [17] },
      }) as Record<string, unknown>;

      expect(where['appuserTransactionCategories']).toEqual({ $some: { categoryKey: { $in: [17] } } });
    });

    it('matches uncategorized transactions by the absence of any category row', () => {
      const where = buildTransactionWhere({
        categoryKeys: { includeUncategorized: true, keys: [] },
      }) as Record<string, unknown>;

      expect(where['appuserTransactionCategories']).toEqual({ $none: {} });
    });

    /**
     * The one that matters. Selecting categories *and* "Uncategorized" is a union — the browser
     * code it replaces was literally `isUncategorizedMatch || isCategoryMatch`.
     *
     * `$some` is load-bearing here and must not be "simplified" to
     * `{ appuserTransactionCategories: { categoryKey: { $in: keys } } }`. MikroORM folds both
     * branches into one join on the collection, where `$in` and `$none` contradict and `$in` wins,
     * so the union silently collapses to the named branch. Measured on real data: the implicit form
     * returned 171 where the true union is 2,976 (171 named + 2,805 uncategorized).
     *
     * A wrong answer here is invisible — the table just shows fewer rows — so it is asserted
     * structurally rather than left to a reviewer to notice.
     */
    it('unions named categories and uncategorized as separate $some/$none branches', () => {
      const where = buildTransactionWhere({
        categoryKeys: { includeUncategorized: true, keys: [17, 23] },
      }) as Record<string, unknown>;

      expect(where['$or']).toEqual([
        { appuserTransactionCategories: { $some: { categoryKey: { $in: [17, 23] } } } },
        { appuserTransactionCategories: { $none: {} } },
      ]);
      // Never both a top-level collection clause and an $or — that is the shared-join shape.
      expect(where['appuserTransactionCategories']).toBeUndefined();
    });
  });

  it('combines every dimension at once', () => {
    const fromDate = new Date('2026-01-01T00:00:00Z');
    const toDate = new Date('2026-12-31T00:00:00Z');
    const where = buildTransactionWhere({
      accountKeys: [4],
      categoryKeys: { includeUncategorized: false, keys: [17] },
      confidence: CategorizationConfidence.LOW,
      fromDate,
      toDate,
      transactionTypes: ['CARD_PAYMENT'],
      unreviewedOnly: true,
    }) as Record<string, unknown>;

    expect(where['accountKey']).toEqual({ accountKey: { $in: [4] }, deletedAt: undefined });
    expect(where['reviewed']).toBe(false);
    expect(where['categorizationConfidence']).toBe(CategorizationConfidence.LOW);
    expect(where['transactionTypeKey']).toEqual({ name: { $in: ['CARD_PAYMENT'] } });
    expect(where['appuserTransactionCategories']).toEqual({ $some: { categoryKey: { $in: [17] } } });
    expect(where['transactionDate']).toEqual({ $gte: fromDate, $lte: toDate });
  });
});
