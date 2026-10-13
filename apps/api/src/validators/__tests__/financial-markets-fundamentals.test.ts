import { describe, expect, it } from 'vitest';

import { getFundamentalsRequestSchema } from '../financial-markets';

describe('financial markets fundamentals validator', () => {
  it('accepts valid symbols and rejects invalid ones', () => {
    expect(getFundamentalsRequestSchema.parse({ params: { ticker: 'AAPL' } })).toEqual({ params: { ticker: 'AAPL' } });
    expect(getFundamentalsRequestSchema.safeParse({ params: { ticker: 'A'.repeat(21) } }).success).toBe(false);
  });
});
