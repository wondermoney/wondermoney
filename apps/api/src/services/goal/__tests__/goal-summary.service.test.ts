import { describe, expect, it } from 'vitest';

import { buildGoalSummary } from '../goal-summary.service';

describe('buildGoalSummary', () => {
  it('derives required contribution from target date and marks behind when assigned is short', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 100,
      availableAmount: 250,
      now: new Date('2024-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
      targetDate: new Date('2024-04-15T00:00:00.000Z'),
    });

    expect(
      result
    ).toEqual({
      assignedThisMonth: 100,
      availableAmount: 250,
      fundedHistorically: 250,
      monthlyShortfall: 150,
      progressPercentage: 25,
      remainingToTarget: 750,
      requiredMonthlyContribution: 250,
      spentAmount: 0,
      status: 'behind',
    });
  });

  it('marks goal as funded when available reaches target', () => {
    expect(
      buildGoalSummary({
        assignedThisMonth: 0,
        availableAmount: 1000,
        now: new Date('2024-01-15T00:00:00.000Z'),
        paused: false,
        spentAmount: 0,
        targetAmount: 1000,
      }).status,
    ).toBe('funded');
  });

  it('adds a debt projection with payoff date and paid-down progress for debt goals', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 0,
      debt: { annualInterestRateBps: 1200, currentBalance: 900, extraPayment: 0, minimumPayment: 100 },
      isDebt: true,
      now: new Date('2026-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000, // original balance; 100 already paid down
    });

    expect(result.debtProjection).toBeDefined();
    expect(result.debtProjection?.paysOff).toBe(true);
    expect(result.debtProjection?.monthlyPayment).toBe(100);
    expect(result.debtProjection?.paidOffAmount).toBe(100);
    expect(result.debtProjection?.progressPercentage).toBe(10);
    expect(result.debtProjection?.currentBalance).toBe(900);
    expect(result.debtProjection?.payoffDate).not.toBeNull();
    expect(result.debtProjection?.totalInterest).toBeGreaterThan(0);
  });

  it('folds funded available amount into a debt goal\'s paid-off amount and remaining balance', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 500,
      debt: { annualInterestRateBps: 1200, currentBalance: null, extraPayment: 0, minimumPayment: 100 },
      isDebt: true,
      now: new Date('2026-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
    });

    // No reported balance; funded amount is the only payment tracked.
    expect(result.debtProjection?.paidOffAmount).toBe(500);
    expect(result.debtProjection?.progressPercentage).toBe(50);
    // Remaining balance for projection purposes is original - paidOff.
    expect(result.debtProjection?.currentBalance).toBe(500);
    // Summary progress also reflects the funding, matching the detail view.
    expect(result.progressPercentage).toBe(50);
  });

  it('combines user-reported balance reduction and funded amount in debt progress', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 300,
      debt: { annualInterestRateBps: 1200, currentBalance: 600, extraPayment: 0, minimumPayment: 100 },
      isDebt: true,
      now: new Date('2026-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
    });

    // user-reported: 1000 - 600 = 400 paid outside; funded: 300; total: 700.
    expect(result.debtProjection?.paidOffAmount).toBe(700);
    expect(result.debtProjection?.progressPercentage).toBe(70);
    expect(result.debtProjection?.currentBalance).toBe(300);
  });

  it('flags a debt goal that never pays off', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 0,
      debt: { annualInterestRateBps: 2400, currentBalance: 1000, extraPayment: 0, minimumPayment: 15 },
      isDebt: true,
      now: new Date('2026-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
    });

    expect(result.debtProjection?.paysOff).toBe(false);
    expect(result.debtProjection?.months).toBeNull();
    expect(result.debtProjection?.payoffDate).toBeNull();
  });

  it('omits debt projection for save-up goals', () => {
    const result = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 0,
      now: new Date('2026-01-15T00:00:00.000Z'),
      paused: false,
      spentAmount: 0,
      targetAmount: 1000,
    });

    expect(result.debtProjection).toBeUndefined();
  });

  it('keeps spent amount separate from available and tracks funded historically', () => {
    expect(
      buildGoalSummary({
        assignedThisMonth: 0,
        availableAmount: 700,
        now: new Date('2024-01-15T00:00:00.000Z'),
        paused: false,
        spentAmount: 300,
        targetAmount: 1000,
      }),
    ).toEqual({
      assignedThisMonth: 0,
      availableAmount: 700,
      fundedHistorically: 1000,
      monthlyShortfall: null,
      progressPercentage: 70,
      remainingToTarget: 300,
      requiredMonthlyContribution: null,
      spentAmount: 300,
      status: 'on_track',
    });
  });

  it('returns null contribution and shortfall without a target date', () => {
    expect(
      buildGoalSummary({
        assignedThisMonth: 0,
        availableAmount: 100,
        now: new Date('2024-01-15T00:00:00.000Z'),
        paused: false,
        spentAmount: 0,
        targetAmount: 1000,
      }),
    ).toMatchObject({
      monthlyShortfall: null,
      requiredMonthlyContribution: null,
      status: 'on_track',
    });
  });

  it('caps progress percentage at 100', () => {
    expect(
      buildGoalSummary({
        assignedThisMonth: 0,
        availableAmount: 1200,
        now: new Date('2024-01-15T00:00:00.000Z'),
        paused: false,
        spentAmount: 0,
        targetAmount: 1000,
      }).progressPercentage,
    ).toBe(100);
  });
});
