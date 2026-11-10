import { describe, expect, it } from 'vitest';

import { valuePortfolioHoldings } from '../portfolio-value';

describe('valuePortfolioHoldings', () => {
  it('sums the current value of every holding exactly', () => {
    const result = valuePortfolioHoldings([{ currentValue: 0.1 }, { currentValue: 0.2 }, { currentValue: 2578.16 }]);

    expect(result).toEqual({ isComplete: true, value: 2578.46 });
  });

  it('leaves out holdings with more units sold than bought, as the dashboards do', () => {
    const result = valuePortfolioHoldings([{ currentValue: 100 }, { currentValue: 40, isInvalid: true }]);

    expect(result).toEqual({ isComplete: true, value: 100 });
  });

  it('values what it can and flags the total incomplete when a holding has no price', () => {
    const result = valuePortfolioHoldings([{ currentValue: 100 }, { currentValue: null }]);

    expect(result).toEqual({ isComplete: false, value: 100 });
  });

  it('values an empty portfolio at zero', () => {
    expect(valuePortfolioHoldings([])).toEqual({ isComplete: true, value: 0 });
  });
});
