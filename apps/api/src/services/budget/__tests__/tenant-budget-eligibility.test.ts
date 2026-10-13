import { describe, expect, it } from 'vitest';

import type { BudgetAllocationRow } from '../aggregation-types';
import {
  accountKeysForAllocation,
  partitionByEligibility,
  suppressionReasonForBudget,
  uniqueAllocations,
} from '../tenant-budget-eligibility';

const baseRow = (overrides: Partial<BudgetAllocationRow> = {}): BudgetAllocationRow => ({
  accountClosed: false,
  accountDeleted: false,
  accountKey: 1,
  accountOwnerAppuserKey: 7,
  accountTenantKey: 11,
  amountBudgeted: '100.00',
  budgetKey: 1,
  budgetName: 'Groceries',
  budgetTemplateCategoryKey: 10,
  categoryKey: 100,
  categoryName: 'Food',
  categoryOwnerAppuserKey: 7,
  categorySystem: false,
  currencyCode: 'EUR',
  parentCategoryKey: 99,
  parentCategoryName: 'Food parent',
  parentCategoryOwnerAppuserKey: 7,
  parentCategorySystem: false,
  ...overrides,
});

describe('partitionByEligibility', () => {
  it('returns all valid allocations and no suppressed budgets when every account belongs to the tenant and the user', () => {
    const rows = [
      baseRow({ accountKey: 1, budgetTemplateCategoryKey: 10 }),
      baseRow({ accountKey: 2, accountOwnerAppuserKey: 7, accountTenantKey: 11, budgetTemplateCategoryKey: 10 }),
    ];

    const result = partitionByEligibility(rows, { appuserKey: 7, tenantKey: 11 });

    expect(result.suppressedBudgets).toEqual([]);
    expect(result.rows).toEqual(rows);
  });

  it('withholds the entire budget when one row links to a foreign tenant', () => {
    const rows = [
      baseRow({ accountKey: 1, accountTenantKey: 11 }),
      baseRow({ accountKey: 2, accountOwnerAppuserKey: 7, accountTenantKey: 22 }),
    ];

    const result = partitionByEligibility(rows, { appuserKey: 7, tenantKey: 11 });

    expect(result.rows).toEqual([]);
    expect(result.suppressedBudgets).toEqual([{ budgetKey: 1, reason: 'budget_account_tenant_mismatch' }]);
  });

  it('prefers budget_account_owner_mismatch over budget_account_tenant_mismatch', () => {
    const rows = [
      baseRow({ accountOwnerAppuserKey: 7, accountTenantKey: 22 }),
      baseRow({ accountOwnerAppuserKey: 99, accountTenantKey: 11 }),
    ];

    const result = partitionByEligibility(rows, { appuserKey: 7, tenantKey: 11 });

    expect(result.suppressedBudgets).toEqual([{ budgetKey: 1, reason: 'budget_account_owner_mismatch' }]);
  });

  it('emits suppression reasons in ascending budgetKey order', () => {
    const rows = [
      baseRow({ accountClosed: null, accountDeleted: null, accountKey: null, accountOwnerAppuserKey: null, accountTenantKey: null, budgetKey: 3 }),
      baseRow({ accountKey: 1, accountOwnerAppuserKey: 7, accountTenantKey: 22, budgetKey: 1 }),
    ];

    const result = partitionByEligibility(rows, { appuserKey: 7, tenantKey: 11 });

    expect(result.suppressedBudgets).toEqual([
      { budgetKey: 1, reason: 'budget_account_tenant_mismatch' },
      { budgetKey: 3, reason: 'budget_no_accounts' },
    ]);
  });

  it('skips rows whose parent category is null', () => {
    const rows = [
      baseRow({ parentCategoryKey: null, parentCategoryName: null }),
      baseRow({ budgetTemplateCategoryKey: 11 }),
    ];

    const result = partitionByEligibility(rows, { appuserKey: 7, tenantKey: 11 });

    // The parentless row is dropped before grouping, so its budget is empty and omitted
    // entirely; only the second row's budget surfaces.
    expect(result.suppressedBudgets).toEqual([]);
    expect(result.rows).toEqual([baseRow({ budgetTemplateCategoryKey: 11 })]);
  });
});

describe('suppressionReasonForBudget', () => {
  it('returns null when every row passes all four checks', () => {
    expect(suppressionReasonForBudget([baseRow()], 7, 11)).toBeNull();
  });

  it('returns budget_no_accounts when no row carries an account link', () => {
    const rows = [baseRow({ accountClosed: null, accountDeleted: null, accountKey: null, accountOwnerAppuserKey: null, accountTenantKey: null })];
    expect(suppressionReasonForBudget(rows, 7, 11)).toBe('budget_no_accounts');
  });

  it('returns budget_account_unavailable when any account is closed or deleted', () => {
    const rows = [
      baseRow({ accountClosed: true, accountKey: 1 }),
      baseRow({ accountClosed: false, accountKey: 2 }),
    ];
    expect(suppressionReasonForBudget(rows, 7, 11)).toBe('budget_account_unavailable');
  });
});

describe('uniqueAllocations', () => {
  it('dedupes rows by budgetTemplateCategoryKey', () => {
    const first = baseRow({ accountKey: 1 });
    const second = baseRow({ accountKey: 2 });
    const third = baseRow({ budgetTemplateCategoryKey: 11 });

    // Map preserves last-write-wins for duplicate keys; the second row replaces the first for
    // the same `budgetTemplateCategoryKey`. The third row has a unique key and surfaces as-is.
    expect(uniqueAllocations([first, second, third])).toEqual([second, third]);
  });
});

describe('accountKeysForAllocation', () => {
  it('returns deduplicated, ascending account keys for one allocation only', () => {
    const rows = [
      baseRow({ accountKey: 3, budgetTemplateCategoryKey: 10 }),
      baseRow({ accountKey: 1, budgetTemplateCategoryKey: 10 }),
      baseRow({ accountKey: 1, budgetTemplateCategoryKey: 10 }),
      baseRow({ accountKey: 9, budgetTemplateCategoryKey: 11 }),
    ];

    expect(accountKeysForAllocation(rows, 10)).toEqual([1, 3]);
    expect(accountKeysForAllocation(rows, 11)).toEqual([9]);
    expect(accountKeysForAllocation(rows, 999)).toEqual([]);
  });
});
