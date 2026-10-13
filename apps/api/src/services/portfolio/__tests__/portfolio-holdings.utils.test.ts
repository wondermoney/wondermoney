import { describe, expect, it } from 'vitest';

import { type PortfolioHolding, recomputeAllocation } from '../portfolio-holdings.utils';

describe('recomputeAllocation', () => {
  it('splits allocation proportionally across the combined holdings', () => {
    const holdings = [
      { currentValue: 300 } as unknown as PortfolioHolding,
      { currentValue: 700 } as unknown as PortfolioHolding,
      { currentValue: null } as unknown as PortfolioHolding,
    ];
    const result = recomputeAllocation(holdings);
    expect(result[0]!.allocation).toBeCloseTo(30, 5);
    expect(result[1]!.allocation).toBeCloseTo(70, 5);
    expect(result[2]!.allocation).toBeNull();
  });

  it('returns null allocation for every holding when total value is zero', () => {
    const holdings = [{ currentValue: 0 } as unknown as PortfolioHolding, { currentValue: null } as unknown as PortfolioHolding];
    const result = recomputeAllocation(holdings);
    expect(result.every((h) => h.allocation === null)).toBe(true);
  });

  it('does not mutate the input holdings', () => {
    const holdings = [{ allocation: null, currentValue: 100 } as unknown as PortfolioHolding];
    const result = recomputeAllocation(holdings);
    expect(result).not.toBe(holdings);
    expect(result[0]).not.toBe(holdings[0]);
  });
});
