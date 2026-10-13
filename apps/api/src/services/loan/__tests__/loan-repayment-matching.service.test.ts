import { describe, expect, it } from 'vitest';

import { scoreLoanRepaymentCandidate } from '../loan-repayment-matching.service';

describe('scoreLoanRepaymentCandidate', () => {
  it('gives a high confidence score for amount, merchant, and date matches', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: -500,
      loanMerchantName: 'Wonder Bank',
      merchantName: 'Wonder Bank',
      paymentDayOfMonth: 15,
      transactionDate: new Date('2026-05-15T10:00:00Z'),
      transactionDirection: 'OUTFLOW',
    });

    expect(result).toMatchObject({
      confidence: 'HIGH',
      reasons: expect.arrayContaining(['amount_match', 'merchant_match', 'date_match']),
      score: expect.any(Number),
    });
    expect(result.score).toBeGreaterThanOrEqual(85);
  });

  it('also allows high confidence with recurring pattern evidence instead of date proximity', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 500,
      loanMerchantName: 'Wonder Bank',
      merchantName: 'Wonder Bank',
      paymentDayOfMonth: 15,
      recurringPatternEvidence: true,
      transactionDirection: 'OUTFLOW',
    });

    expect(result).toMatchObject({
      confidence: 'HIGH',
      reasons: expect.arrayContaining(['amount_match', 'merchant_match', 'monthly_pattern']),
    });
  });

  it('does not award monthly pattern without strong recurring evidence', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 500,
      loanMerchantName: 'Wonder Bank',
      merchantName: 'Wonder Bank',
      paymentDayOfMonth: 15,
      transactionDate: new Date('2026-05-22T10:00:00Z'),
      transactionDirection: 'OUTFLOW',
    });

    expect(result.reasons).not.toContain('monthly_pattern');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('keeps same-day evidence as date match but not monthly pattern', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 500,
      paymentDayOfMonth: 15,
      transactionDate: new Date('2026-05-15T10:00:00Z'),
      transactionDirection: 'OUTFLOW',
    });

    expect(result.reasons).toContain('date_match');
    expect(result.reasons).not.toContain('monthly_pattern');
  });

  it('matches payment days across month boundaries', () => {
    const endOfMonthResult = scoreLoanRepaymentCandidate({
      amount: 500,
      paymentDayOfMonth: 31,
      transactionDate: new Date('2026-05-01T10:00:00Z'),
      transactionDirection: 'OUTFLOW',
    });

    expect(endOfMonthResult.reasons).toContain('date_match');

    const startOfMonthResult = scoreLoanRepaymentCandidate({
      amount: 500,
      paymentDayOfMonth: 1,
      transactionDate: new Date('2026-05-31T10:00:00Z'),
      transactionDirection: 'OUTFLOW',
    });

    expect(startOfMonthResult.reasons).toContain('date_match');
  });

  it('gives a medium confidence score for amount-only matches', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 250,
      transactionDirection: 'OUTFLOW',
    });

    expect(result).toEqual({
      confidence: 'MEDIUM',
      reasons: ['amount_match'],
      score: 60,
    });
  });

  it('marks inflows as ineligible', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 250,
      transactionDirection: 'INFLOW',
    });

    expect(result).toEqual({
      confidence: 'LOW',
      reasons: ['inflow_ineligible'],
      score: 0,
    });
  });

  it('penalizes poor amount matches', () => {
    const result = scoreLoanRepaymentCandidate({
      amount: 250,
      candidateAmount: 50,
      transactionDirection: 'OUTFLOW',
    });

    expect(result.confidence).toBe('LOW');
    expect(result.reasons).toContain('amount_mismatch');
    expect(result.score).toBeLessThan(25);
  });
});
