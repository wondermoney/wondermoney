import { describe, expect, it } from 'vitest';

import { compareStrategies, projectPayoff } from '../debt-projection.service';

describe('projectPayoff', () => {
  it('pays off a 0% debt in exact whole months', () => {
    const result = projectPayoff({ annualInterestRateBps: 0, balance: 1200, monthlyPayment: 100 });

    expect(result.paysOff).toBe(true);
    expect(result.months).toBe(12);
    expect(result.totalInterest).toBe(0);
    expect(result.schedule).toHaveLength(12);
    expect(result.schedule.at(-1)?.endingBalance).toBe(0);
  });

  it('amortises an interest-bearing debt with a consistent schedule', () => {
    const result = projectPayoff({ annualInterestRateBps: 1200, balance: 1000, monthlyPayment: 100 });

    expect(result.paysOff).toBe(true);
    // calculateRemainingTermMonths(1000 @ 12% APR, payment 100) => 11
    expect(result.months).toBe(11);
    expect(result.schedule).toHaveLength(11);
    expect(result.schedule.at(-1)?.endingBalance).toBe(0);

    // Internal consistency: each month chains, interest is positive, principal reconciles.
    let previousEnding = 1000;
    let interestSum = 0;
    let principalSum = 0;
    for (const entry of result.schedule) {
      expect(entry.startingBalance).toBe(previousEnding);
      expect(entry.interest).toBeGreaterThan(0);
      // Principal already excludes interest, so it alone reduces the balance.
      expect(entry.endingBalance).toBeCloseTo(entry.startingBalance - entry.principal, 2);
      previousEnding = entry.endingBalance;
      interestSum += entry.interest;
      principalSum += entry.principal;
    }
    expect(principalSum).toBeCloseTo(1000, 2);
    expect(result.totalInterest).toBeCloseTo(interestSum, 2);
    expect(result.totalInterest).toBeGreaterThan(0);
  });

  it('reports that a debt never pays off when the payment is below the monthly interest', () => {
    // 1000 @ 24% APR => monthly interest 20; payment 15 < 20.
    const result = projectPayoff({ annualInterestRateBps: 2400, balance: 1000, monthlyPayment: 15 });

    expect(result.paysOff).toBe(false);
    expect(result.months).toBeNull();
    expect(result.totalInterest).toBe(0);
    expect(result.schedule).toEqual([]);
  });
});

describe('compareStrategies', () => {
  it('orders avalanche by rate and snowball by balance, and avalanche costs no more interest', () => {
    const debts = [
      { annualInterestRateBps: 2500, balance: 1000, id: 1, minimumPayment: 50 }, // high rate, high balance
      { annualInterestRateBps: 800, balance: 500, id: 2, minimumPayment: 50 }, // low rate, low balance
    ];

    const { avalanche, snowball } = compareStrategies({ debts, extraBudget: 100 });

    expect(avalanche.order[0]).toBe(1); // highest rate first
    expect(snowball.order[0]).toBe(2); // lowest balance first
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
    expect(avalanche.months).toBeGreaterThan(0);
    expect(snowball.months).toBeGreaterThan(0);
  });

  it('rolls a cleared debt’s minimum payment onto the next debt', () => {
    const debts = [
      { annualInterestRateBps: 0, balance: 100, id: 1, minimumPayment: 100 },
      { annualInterestRateBps: 0, balance: 1000, id: 2, minimumPayment: 100 },
    ];

    const { avalanche } = compareStrategies({ debts, extraBudget: 0 });

    const debtOne = avalanche.perDebt.find((d) => d.id === 1);
    const debtTwo = avalanche.perDebt.find((d) => d.id === 2);
    expect(debtOne?.months).toBe(1);
    // Debt 2: 100/mo in month 1, then debt 1's freed 100/mo rolls in => 200/mo. Cleared month 6.
    expect(debtTwo?.months).toBe(6);
    expect(avalanche.months).toBe(6);
    expect(avalanche.totalInterest).toBe(0);
  });
});
