import { describe, expect, it } from 'vitest';

import { buildSpendingByCategoryCsv } from '../spendingByCategory.service';

describe('buildSpendingByCategoryCsv', () => {
  it('emits the contract column order with 2-decimal amounts and a BOM', () => {
    const csv = buildSpendingByCategoryCsv([
      {
        categoryKey: '10',
        color: '#f3f3f3',
        name: 'Food',
        parentKey: null,
        percentOfTotal: 60,
        totalAmount: 60.5,
        transactionCount: 2,
      },
    ]);

    expect(csv).toBe('\uFEFFcategoryKey,parentKey,name,color,totalAmount,transactionCount,percentOfTotal\n10,,Food,#f3f3f3,60.50,2,60.00\n');
  });
});
