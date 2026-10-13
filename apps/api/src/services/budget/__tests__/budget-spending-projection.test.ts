import Big from 'big.js';
import { describe, expect, it } from 'vitest';

import type { CategorizedTransaction, ClassifiedThreshold } from '../aggregation-classifier';
import type { BudgetAllocationRow } from '../aggregation-types';
import { buildBudgetPressure, spendForAllocation } from '../budget-spending-projection';

const allocation = (overrides: Partial<BudgetAllocationRow> = {}): BudgetAllocationRow => ({
  accountClosed: false,
  accountDeleted: false,
  accountKey: 3,
  accountOwnerAppuserKey: 7,
  accountTenantKey: 11,
  amountBudgeted: '100',
  budgetKey: 1,
  budgetName: 'July plan',
  budgetTemplateCategoryKey: 2,
  categoryKey: 10,
  categoryName: 'Groceries',
  categoryOwnerAppuserKey: 7,
  categorySystem: false,
  currencyCode: 'EUR',
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  parentCategoryOwnerAppuserKey: 7,
  parentCategorySystem: false,
  ...overrides,
});

const transaction = (overrides: Partial<CategorizedTransaction> = {}): CategorizedTransaction => ({
  accountKey: 3,
  amount: new Big(80),
  categoryKey: 10,
  categoryName: 'Groceries',
  parentCategoryKey: 9,
  parentCategoryName: 'Food',
  transactionDate: new Date('2026-07-07T12:00:00Z'),
  transactionKey: 50,
  ...overrides,
});

describe('spendForAllocation', () => {
  it('sums only transactions sharing the allocation category on a linked account', () => {
    const target = allocation();
    const rows = [target];
    const spent = spendForAllocation(
      target,
      [
        transaction({ amount: new Big(30), transactionKey: 1 }),
        transaction({ amount: new Big(50), transactionKey: 2 }),
        transaction({ categoryKey: 20, transactionKey: 3 }), // other category
        transaction({ accountKey: 99, transactionKey: 4 }), // unlinked account
      ],
      rows,
    );

    expect(spent.toFixed(0)).toBe('80');
  });

  it('nets signed refunds against spend and floors the total at zero', () => {
    const target = allocation();
    const netPositive = spendForAllocation(
      target,
      [
        transaction({ amount: new Big(50), transactionKey: 1 }),
        transaction({ amount: new Big(-20), transactionKey: 2 }),
      ],
      [target],
    );
    expect(netPositive.toFixed(0)).toBe('30');

    const netNegative = spendForAllocation(
      target,
      [
        transaction({ amount: new Big(10), transactionKey: 1 }),
        transaction({ amount: new Big(-40), transactionKey: 2 }),
      ],
      [target],
    );
    expect(netNegative.toFixed(0)).toBe('0');
  });

  it('counts every account linked to the allocation, not just the measured row', () => {
    const target = allocation({ accountKey: 3 });
    const rows = [target, allocation({ accountKey: 5 })];
    const spent = spendForAllocation(
      target,
      [
        transaction({ accountKey: 3, amount: new Big(10), transactionKey: 1 }),
        transaction({ accountKey: 5, amount: new Big(15), transactionKey: 2 }),
      ],
      rows,
    );

    expect(spent.toFixed(0)).toBe('25');
  });

  it('returns zero when no transaction matches the allocation', () => {
    const target = allocation();
    expect(spendForAllocation(target, [], [target]).toFixed(0)).toBe('0');
  });
});

describe('buildBudgetPressure', () => {
  const near: ClassifiedThreshold = { claimThresholds: [80], state: 'near', threshold: 80 };
  const over: ClassifiedThreshold = { claimThresholds: [80, 100], state: 'over', threshold: 100 };
  const atLimit: ClassifiedThreshold = { claimThresholds: [80, 100], state: 'at_limit', threshold: 100 };

  it('returns null for an empty threshold set', () => {
    expect(buildBudgetPressure([])).toBeNull();
  });

  it('returns over when any allocation is over budget', () => {
    expect(buildBudgetPressure([null, over, null])).toBe('over');
  });

  it('treats at_limit as over', () => {
    expect(buildBudgetPressure([near, atLimit])).toBe('over');
  });

  it('returns near when near is present and nothing is over', () => {
    expect(buildBudgetPressure([null, near, null])).toBe('near');
  });

  it('lets over take priority over near', () => {
    expect(buildBudgetPressure([near, over, atLimit])).toBe('over');
  });

  it('returns within_plan when every allocation is below the near threshold', () => {
    expect(buildBudgetPressure([null, null])).toBe('within_plan');
  });
});
