import { describe, expect, it } from 'vitest';

import {
  buildEffectiveAmountSql,
  filterExpenseTransactions,
  getEffectiveAppuserAmount,
  mapCategorySpendingByName,
} from '@utils/account-amounts';

describe('account aggregation scenarios', () => {
  it('uses edited amounts consistently across spending and metrics semantics', () => {
    const transactions = [
      {
        appuserSettlementAmount: -100,
        category: {
          bgColor: '#111111',
          categoryKey: 1,
          icon: 'fork-knife',
          isSystemCategory: true,
          name: 'Food',
          parentCategory: null,
          textColor: '#ffffff',
        },
        editedSettlementAmount: -40,
      },
      {
        appuserSettlementAmount: 500,
        category: null,
      },
      {
        appuserSettlementAmount: -80,
        category: {
          bgColor: '#333333',
          categoryKey: 2,
          icon: 'car',
          isSystemCategory: true,
          name: 'Transport',
          parentCategory: null,
          textColor: '#ffffff',
        },
        editedSettlementAmount: 20,
      },
    ];

    const expenseTransactions = filterExpenseTransactions(transactions);
    const spending = mapCategorySpendingByName(expenseTransactions as never[]);
    const inflow = transactions
      .map((transaction) => getEffectiveAppuserAmount(transaction))
      .filter((amount) => amount > 0)
      .reduce((sum, amount) => sum + amount, 0);
    const outflow = transactions
      .map((transaction) => getEffectiveAppuserAmount(transaction))
      .filter((amount) => amount < 0)
      .reduce((sum, amount) => sum + amount, 0);

    expect(expenseTransactions).toHaveLength(1);
    expect(spending).toMatchObject([
      {
        amount: 40,
        name: 'Food',
        numTransactions: 1,
      },
    ]);
    expect(inflow).toBe(520);
    expect(outflow).toBe(-40);
  });

  it('builds metrics SQL that prefers edited settlement amounts', () => {
    expect(buildEffectiveAmountSql('t')).toBe('COALESCE(t.edited_settlement_amount, t.appuser_settlement_amount)');
  });
});
