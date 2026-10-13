import { describe, expect, it } from 'vitest';

import { deriveMostRecentUserMapping } from '../backfill-merchant-mapping-derivation';

describe('deriveMostRecentUserMapping', () => {
  it('picks the most-recent categorization per (appuser, merchant)', () => {
    const rows = [
      { appuserKey: 1, categoryKey: 10, key: 100, transactionMerchantKey: 9, updatedAt: '2026-01-01T00:00:00Z' },
      { appuserKey: 1, categoryKey: 11, key: 200, transactionMerchantKey: 9, updatedAt: '2026-06-01T00:00:00Z' },
    ];
    expect(deriveMostRecentUserMapping(rows)).toEqual([{ appuserKey: 1, categoryKey: 11, transactionMerchantKey: 9 }]);
  });

  it('keys winners per (appuser, merchant) independently', () => {
    const rows = [
      { appuserKey: 1, categoryKey: 10, key: 1, transactionMerchantKey: 9, updatedAt: '2026-01-01T00:00:00Z' },
      { appuserKey: 2, categoryKey: 12, key: 2, transactionMerchantKey: 9, updatedAt: '2026-01-01T00:00:00Z' },
      { appuserKey: 1, categoryKey: 13, key: 3, transactionMerchantKey: 8, updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const result = deriveMostRecentUserMapping(rows);
    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ appuserKey: 1, categoryKey: 10, transactionMerchantKey: 9 });
    expect(result).toContainEqual({ appuserKey: 2, categoryKey: 12, transactionMerchantKey: 9 });
    expect(result).toContainEqual({ appuserKey: 1, categoryKey: 13, transactionMerchantKey: 8 });
  });

  it('breaks equal-timestamp ties by higher assignment key (deterministic)', () => {
    const rows = [
      { appuserKey: 1, categoryKey: 10, key: 5, transactionMerchantKey: 9, updatedAt: '2026-01-01T00:00:00Z' },
      { appuserKey: 1, categoryKey: 11, key: 9, transactionMerchantKey: 9, updatedAt: '2026-01-01T00:00:00Z' },
    ];
    expect(deriveMostRecentUserMapping(rows)).toEqual([{ appuserKey: 1, categoryKey: 11, transactionMerchantKey: 9 }]);
  });

  it('returns empty for empty input', () => {
    expect(deriveMostRecentUserMapping([])).toEqual([]);
  });
});
