import { describe, expect, it } from 'vitest';

import {
  assertDemoResetPreflight,
  buildResetInvariantSummary,
  ensureAtLeastOneDemoEntity,
  ensureSingleDemoEntity,
} from '../reset-demo-data.helpers';

describe('reset-demo-data helpers', () => {
  it('requires exactly one active demo entity', () => {
    expect(() => {
      ensureSingleDemoEntity([], 'demo appuser');
    }).toThrow('Expected exactly one active demo appuser, found 0');
    expect(() => ensureSingleDemoEntity([{ id: 1 }, { id: 2 }], 'demo tenant')).toThrow(
      'Expected exactly one active demo tenant, found 2',
    );
    expect(ensureSingleDemoEntity([{ id: 1 }], 'demo tenant')).toEqual({ id: 1 });
  });

  it('accepts at least one active demo entity', () => {
    expect(ensureAtLeastOneDemoEntity([{ id: 1 }], 'demo link')).toEqual({ id: 1 });
    expect(() => ensureAtLeastOneDemoEntity([], 'demo link')).toThrow(
      'Expected at least one active demo link, found 0',
    );
  });

  it('summarizes reset invariants', () => {
    expect(
      buildResetInvariantSummary({
        accounts: 2,
        budgets: 1,
        loans: 1,
        pendingImports: 0,
        pendingOperations: 0,
        portfolios: 1,
      }),
    ).toMatchObject({
      hasAtLeastTwoDemoAccounts: true,
      hasBudget: true,
      hasLoan: true,
      hasPortfolio: true,
      noPendingDemoBackgroundOperations: true,
      noPendingDemoImports: true,
    });
  });

  it('fails preflight when pending work exists', () => {
    expect(() => {
      assertDemoResetPreflight({ pendingImports: 1, pendingOperations: 0 });
    }).toThrow('Demo reset preflight failed');
    expect(() => {
      assertDemoResetPreflight({ pendingImports: 0, pendingOperations: 1 });
    }).toThrow('Demo reset preflight failed');
    expect(() => {
      assertDemoResetPreflight({ pendingImports: 0, pendingOperations: 0 });
    }).not.toThrow();
  });

  it('fails invariants when counts are missing', () => {
    expect(
      buildResetInvariantSummary({
        accounts: 0,
        budgets: 0,
        loans: 0,
        pendingImports: 0,
        pendingOperations: 0,
        portfolios: 0,
      }),
    ).toMatchObject({
      hasAtLeastTwoDemoAccounts: false,
      hasBudget: false,
      hasLoan: false,
      hasPortfolio: false,
    });
  });
});
