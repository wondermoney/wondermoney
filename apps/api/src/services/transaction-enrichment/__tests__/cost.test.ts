import { describe, expect, it } from 'vitest';

import { estimateTransactionEnrichmentCostUsd } from '../cost';

describe('estimateTransactionEnrichmentCostUsd', () => {
  it('returns zero for zero tokens', () => {
    expect(estimateTransactionEnrichmentCostUsd(0, 0)).toBe(0);
  });

  it('applies the per-1K prompt and completion rates', () => {
    // 1000 prompt tokens = 1 * 0.00027, 1000 completion tokens = 1 * 0.0011.
    expect(estimateTransactionEnrichmentCostUsd(1000, 1000)).toBe(0.00137);
  });

  it('scales linearly with fractional thousands and rounds to 8 decimals', () => {
    // 500 prompt = 0.5 * 0.00027 = 0.000135, 250 completion = 0.25 * 0.0011 = 0.000275.
    expect(estimateTransactionEnrichmentCostUsd(500, 250)).toBe(0.00041);
  });
});
