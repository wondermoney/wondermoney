import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  addBudgetCategoryRequestSchema,
  createBudgetRequestSchema,
  updateBudgetCategoryAmountRequestSchema,
} from '../budget';

// Pulls the first error message for a given field out of a failed safeParse result, without
// wrapping `expect` calls in a conditional (forbidden by vitest/no-conditional-expect).
function firstErrorMessage(result: SafeParseReturnType<unknown, unknown>, fieldName: string): string | undefined {
  return result.success ? undefined : result.error.issues.find((issue) => issue.path.includes(fieldName))?.message;
}

// RAD-637: budget category amounts had no upper bound, so an edge-case entry like 99999999 was
// accepted and propagated through Total Budgeted, Budget Remaining, utilization %, and Net Worth
// History. These tests pin the sanity ceiling (999,999,999, matching the pre-existing income-amount
// cap in createBudgetRequestSchema) at the validator boundary.
describe('budget validators — category amount upper bound (RAD-637)', () => {
  describe('addBudgetCategoryRequestSchema', () => {
    it('rejects an amount over the ceiling with a clear error message', () => {
      const result = addBudgetCategoryRequestSchema.safeParse({
        body: { amountBudgeted: 1000000000, categoryKey: 3 },
        params: { budgetKey: 7 },
      });

      expect(result.success).toBe(false);
      expect(firstErrorMessage(result, 'amountBudgeted')).toBe('Amount must be 999,999,999 or less');
    });

    it('still accepts the ticket\'s repro value (99999999) since it is under the chosen ceiling', () => {
      // The ticket's repro value (99,999,999 — eight 9s) is well under the 999,999,999 ceiling
      // chosen here (nine 9s, matching the pre-existing income-amount cap). The ceiling exists to
      // catch genuinely unrealistic fat-finger entries, not to reject every large number — the
      // over-ceiling cases elsewhere in this file cover the actual rejection path.
      const result = addBudgetCategoryRequestSchema.safeParse({
        body: { amountBudgeted: 99999999, categoryKey: 3 },
        params: { budgetKey: 7 },
      });

      expect(result.success).toBe(true);
    });

    it('accepts an amount just under the ceiling', () => {
      const result = addBudgetCategoryRequestSchema.safeParse({
        body: { amountBudgeted: 999999998, categoryKey: 3 },
        params: { budgetKey: 7 },
      });

      expect(result.success).toBe(true);
    });

    it('accepts an amount exactly at the ceiling', () => {
      const result = addBudgetCategoryRequestSchema.safeParse({
        body: { amountBudgeted: 999999999, categoryKey: 3 },
        params: { budgetKey: 7 },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('updateBudgetCategoryAmountRequestSchema', () => {
    it('rejects an amount over the ceiling with a clear error message', () => {
      const result = updateBudgetCategoryAmountRequestSchema.safeParse({
        body: { amount: 1000000000, applyToFollowingMonths: true },
        params: { budgetKey: 7, categoryKey: 3, month: 8, year: 2026 },
      });

      expect(result.success).toBe(false);
      expect(firstErrorMessage(result, 'amount')).toBe('Amount must be 999,999,999 or less');
    });

    it('accepts an amount just under the ceiling', () => {
      const result = updateBudgetCategoryAmountRequestSchema.safeParse({
        body: { amount: 999999998, applyToFollowingMonths: true },
        params: { budgetKey: 7, categoryKey: 3, month: 8, year: 2026 },
      });

      expect(result.success).toBe(true);
    });

    it('still allows omitting amount entirely (optional field)', () => {
      const result = updateBudgetCategoryAmountRequestSchema.safeParse({
        body: { applyToFollowingMonths: true },
        params: { budgetKey: 7, categoryKey: 3, month: 8, year: 2026 },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('createBudgetRequestSchema (income amounts — pre-existing sibling cap)', () => {
    it('rejects an income amount over the same ceiling', () => {
      const result = createBudgetRequestSchema.safeParse({
        body: {
          incomes: [{ amount: 1000000000, isRecurrent: false, name: 'Salary' }],
        },
      });

      expect(result.success).toBe(false);
      expect(firstErrorMessage(result, 'amount')).toBe('Amount must be 999,999,999 or less');
    });

    it('accepts an income amount at the ceiling', () => {
      const result = createBudgetRequestSchema.safeParse({
        body: {
          incomes: [{ amount: 999999999, isRecurrent: false, name: 'Salary' }],
        },
      });

      expect(result.success).toBe(true);
    });
  });
});
