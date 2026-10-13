import { describe, expect, it } from 'vitest';

import { buildPortfolioPerformanceCsv } from '../portfolioPerformance.service';

describe('buildPortfolioPerformanceCsv', () => {
  it('emits the contract column order with 2-decimal amounts', () => {
    const csv = buildPortfolioPerformanceCsv([
      {
        accountKey: '5',
        contributions: 50,
        currency: 'EUR',
        endBalance: 1050,
        name: 'Brokerage',
        return: 50,
        startBalance: 950,
      },
    ]);

    expect(csv).toBe('\uFEFFaccountKey,name,currency,startBalance,endBalance,return,contributions\n5,Brokerage,EUR,950.00,1050.00,50.00,50.00\n');
  });
});
