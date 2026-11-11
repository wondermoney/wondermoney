import { describe, expect, it } from 'vitest';

import { buildGoalSummary } from '@service/goal/goal-summary.service';

import { buildAmortizationSchedule } from '../amortization-schedule';
import { buildLoanProjection, type LoanProjectionInput } from '../loan-projection.service';
import { LoanAmortizationMethod } from '../loan-types';
import { projectPayoff } from '../payoff-projection';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function contractPaymentFor(input: LoanProjectionInput): number {
  return buildAmortizationSchedule({
    annualInterestRateBps: input.annualInterestRateBps,
    firstPaymentDate: input.firstPaymentDate,
    method: input.amortizationMethod,
    principal: input.originalPrincipal,
    termMonths: input.termMonths,
  }).rows[0]?.payment ?? 0;
}

function terms(overrides: Partial<LoanProjectionInput> = {}): LoanProjectionInput {
  return {
    amortizationMethod: LoanAmortizationMethod.FRENCH,
    annualInterestRateBps: 1200,
    extraPayment: 0,
    firstPaymentDate: day('2026-02-15'),
    frequency: 'monthly',
    now: day('2026-01-01'),
    originalPrincipal: 1000,
    outstandingPrincipal: 1000,
    startDate: day('2026-01-01'),
    termMonths: 12,
    ...overrides,
  };
}

describe('buildLoanProjection', () => {
  it('with no extra matches the shared goal projection for the same balance, rate and payment', () => {
    const input = terms();
    const contractPayment = contractPaymentFor(input);

    const projection = buildLoanProjection(input);
    const goal = projectPayoff({
      annualInterestRateBps: input.annualInterestRateBps,
      balance: input.outstandingPrincipal,
      monthlyPayment: contractPayment,
    });

    expect(projection.paysOff).toBe(true);
    expect(projection.months).toBe(goal.months);
    expect(projection.totalInterest).toBe(goal.totalInterest);
    expect(projection.monthsSaved).toBe(0);
    expect(projection.interestSaved).toBe(0);

    // The debt-goal summary is the other caller of the same engine.
    const summary = buildGoalSummary({
      assignedThisMonth: 0,
      availableAmount: 0,
      debt: {
        annualInterestRateBps: input.annualInterestRateBps,
        currentBalance: input.outstandingPrincipal,
        extraPayment: 0,
        minimumPayment: contractPayment,
      },
      isDebt: true,
      now: input.now,
      paused: false,
      spentAmount: 0,
      targetAmount: input.outstandingPrincipal,
    });
    expect(projection.months).toBe(summary.debtProjection?.months);
    expect(projection.totalInterest).toBe(summary.debtProjection?.totalInterest);
  });

  it('shortens the payoff and saves interest with a monthly extra', () => {
    const baseline = buildLoanProjection(terms());
    const withExtra = buildLoanProjection(terms({ extraPayment: 100 }));

    expect(baseline.paysOff).toBe(true);
    expect(withExtra.paysOff).toBe(true);
    const baselineMonths = baseline.months ?? 0;
    const extraMonths = withExtra.months ?? 0;
    expect(extraMonths).toBeLessThan(baselineMonths);
    expect(withExtra.monthsSaved).toBe(baselineMonths - extraMonths);
    expect(withExtra.interestSaved).toBeGreaterThan(0);
    expect(withExtra.interestSaved).toBeCloseTo(baseline.totalInterest - withExtra.totalInterest, 2);
  });

  it('applies a one-off extra at the start date and leaves earlier months on the baseline', () => {
    const baseline = buildLoanProjection(terms());
    const oneOff = buildLoanProjection(terms({ extraPayment: 400, frequency: 'one-off', startDate: day('2026-05-01') }));

    expect(oneOff.paysOff).toBe(true);
    const baselineMonths = baseline.months ?? 0;
    const oneOffMonths = oneOff.months ?? 0;
    expect(oneOffMonths).toBeLessThan(baselineMonths);
    expect(oneOff.monthsSaved).toBe(baselineMonths - oneOffMonths);
    expect(oneOff.interestSaved).toBeGreaterThan(0);

    // Before the start date the two lines are identical; after it the extra line is lower.
    const before = oneOff.series.filter((point) => point.date < '2026-05-01');
    expect(before.length).toBeGreaterThan(0);
    for (const point of before) expect(point.withExtraBalance).toBe(point.baselineBalance);
    expect(oneOff.series.some((point) => point.withExtraBalance < point.baselineBalance)).toBe(true);
  });

  it('applies a one-off extra immediately when the start date is not in the future', () => {
    const input = terms({ extraPayment: 400, frequency: 'one-off', startDate: day('2026-01-01') });
    const oneOff = buildLoanProjection(input);
    const reduced = projectPayoff({
      annualInterestRateBps: input.annualInterestRateBps,
      balance: input.outstandingPrincipal - 400,
      monthlyPayment: contractPaymentFor(input),
    });

    expect(oneOff.paysOff).toBe(true);
    expect(oneOff.months).toBe(reduced.months);
    expect(oneOff.totalInterest).toBe(reduced.totalInterest);
  });

  it('reports that the loan never pays off when the payment is below the monthly interest', () => {
    // 1000 @ 24% APR => 20 monthly interest; a stored payment of 15 never clears it.
    const projection = buildLoanProjection(terms({ annualInterestRateBps: 2400, contractPayment: 15 }));

    expect(projection.paysOff).toBe(false);
    expect(projection.reason).toBe('PAYMENT_BELOW_INTEREST');
    expect(projection.months).toBeNull();
    expect(projection.payoffDate).toBeNull();
    expect(projection.series).toEqual([]);
  });

  it('compares the projected payoff with the contract maturity', () => {
    const baseline = buildLoanProjection(terms());
    // The contract matures at the last instalment, 2027-01-15; the baseline is the contract.
    expect(baseline.aheadOrBehindMonths).toBe(0);

    const withExtra = buildLoanProjection(terms({ extraPayment: 100 }));
    expect(withExtra.aheadOrBehindMonths).toBeGreaterThan(0);
  });
});
