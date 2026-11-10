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
  const VIEWER = { tenantKey: 1, viewerAppuserKey: 2 };

  it('applies no filter clauses when nothing is selected', () => {
    const where = buildTransactionWhere({}, VIEWER) as Record<string, unknown>;

    expect(where['transactionTypeKey']).toBeUndefined();
    expect(where['$or']).toBeUndefined();
    expect(where['appuserTransactionCategories']).toBeUndefined();
  });

  it('filters on transaction type names', () => {
    const where = buildTransactionWhere({ transactionTypes: ['CARD_PAYMENT', 'TRANSFER_IN'] }, VIEWER) as Record<string, unknown>;

    expect(where['transactionTypeKey']).toEqual({ name: { $in: ['CARD_PAYMENT', 'TRANSFER_IN'] } });
  });

  it('treats an empty selection as no filter rather than as a filter matching nothing', () => {
    const where = buildTransactionWhere({
      accountKeys: [],
      categoryKeys: { includeUncategorized: false, keys: [] },
      transactionTypes: [],
    }, VIEWER) as Record<string, unknown>;

    expect(where['transactionTypeKey']).toBeUndefined();
    expect(where['$or']).toBeUndefined();
    expect(where['appuserTransactionCategories']).toBeUndefined();
  });

  describe('category filter', () => {
    it('matches named categories with $some, not the implicit collection form', () => {
      const where = buildTransactionWhere({
        categoryKeys: { includeUncategorized: false, keys: [17] },
      }, VIEWER) as Record<string, unknown>;

      expect(where['$or']).toEqual([
        { appuserTransactionCategories: { $some: { categoryKey: { $in: [17] } } }, splits: { $none: { deletedAt: null } } },
        { splits: { $some: { categoryKey: { $in: [17] }, deletedAt: null } } },
      ]);
    });

    it('matches uncategorized transactions by the absence of any category row', () => {
      const where = buildTransactionWhere({
        categoryKeys: { includeUncategorized: true, keys: [] },
      }, VIEWER) as Record<string, unknown>;

      expect(where['$or']).toEqual([
        { appuserTransactionCategories: { $none: {} }, splits: { $none: { deletedAt: null } } },
        { splits: { $some: { categoryKey: null, deletedAt: null } } },
      ]);
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
      }, VIEWER) as Record<string, unknown>;

      expect(where['$or']).toEqual([
        { appuserTransactionCategories: { $some: { categoryKey: { $in: [17, 23] } } }, splits: { $none: { deletedAt: null } } },
        { splits: { $some: { categoryKey: { $in: [17, 23] }, deletedAt: null } } },
        { appuserTransactionCategories: { $none: {} }, splits: { $none: { deletedAt: null } } },
        { splits: { $some: { categoryKey: null, deletedAt: null } } },
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
    }, VIEWER) as Record<string, unknown>;

    expect(where['reviewed']).toBe(false);
    expect(where['categorizationConfidence']).toBe(CategorizationConfidence.LOW);
    expect(where['transactionTypeKey']).toEqual({ name: { $in: ['CARD_PAYMENT'] } });
    expect(where['$or']).toContainEqual({ splits: { $some: { categoryKey: { $in: [17] }, deletedAt: null } } });
  });
});
