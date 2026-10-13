import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app.js', () => ({ DI: { em: {} } }));

import { assertAllocationWithinTransactionAmount, assertPrincipalWithinOutstanding, buildLoanUpdatePatch, validateMergedLoanUpdate } from '@controller/loan';
import type { Loan } from '@entity/Loan';
import type { Transaction } from '@entity/Transaction';

import { createLoanSchema, linkLoanRepaymentSchema, updateLoanSchema } from '../loan';

describe('loan validators', () => {
  it('creates valid data', () => {
    const result = createLoanSchema.parse({
      body: {
        currencyKey: '1',
        name: 'Mortgage',
        openingBalanceDate: '2026-01-01',
        openingPrincipalBalance: '100000',
        originalPrincipal: '120000',
        rateType: 'FIXED',
        type: 'MORTGAGE',
      },
    });

    expect(result.body.includeInNetWorth).toBe(true);
  });

  it('rejects originalPrincipal lower than openingPrincipalBalance', () => {
    expect(() =>
      createLoanSchema.parse({
        body: {
          currencyKey: '1',
          name: 'Loan',
          openingBalanceDate: '2026-01-01',
          openingPrincipalBalance: '100000',
          originalPrincipal: '90000',
          type: 'OTHER',
        },
      }),
    ).toThrow();
  });

  it('rejects invalid annualInterestRateBps', () => {
    expect(() =>
      createLoanSchema.parse({
        body: {
          annualInterestRateBps: '10001',
          currencyKey: '1',
          name: 'Loan',
          openingBalanceDate: '2026-01-01',
          openingPrincipalBalance: '100000',
          type: 'OTHER',
        },
      }),
    ).toThrow();
  });

  it('rejects maturityDate before or equal openingBalanceDate', () => {
    expect(() =>
      createLoanSchema.parse({
        body: {
          currencyKey: '1',
          maturityDate: '2026-01-01',
          name: 'Loan',
          openingBalanceDate: '2026-01-01',
          openingPrincipalBalance: '100000',
          type: 'OTHER',
        },
      }),
    ).toThrow();
  });

  it('validates loan id params', () => {
    expect(() => updateLoanSchema.parse({ body: {}, params: { loanId: 'abc' } })).toThrow();
  });

  it('rejects merged partial updates that violate principal invariant', () => {
    const loan = {
      openingBalanceDate: new Date('2026-01-01'),
      openingPrincipalBalance: 100_000,
      originalPrincipal: 120_000,
    } as unknown as Loan;
    expect(() => { validateMergedLoanUpdate(loan, { openingPrincipalBalance: 130_000 }); }).toThrow();
  });

  it('rejects merged partial updates that violate maturity invariant', () => {
    const loan = {
      openingBalanceDate: new Date('2026-01-01'),
      openingPrincipalBalance: 100_000,
      originalPrincipal: 120_000,
    } as unknown as Loan;
    expect(() => { validateMergedLoanUpdate(loan, { maturityDate: new Date('2025-12-31') }); }).toThrow();
  });

  it('builds update patch without undefined keys', () => {
    expect(
      buildLoanUpdatePatch({
        includeInNetWorth: false,
        name: 'Updated',
        notes: undefined,
        regularPaymentAmount: 250,
      }),
    ).toEqual({ includeInNetWorth: false, name: 'Updated', regularPaymentAmount: 250 });
  });

  it('accepts a valid repayment link body', () => {
    expect(
      linkLoanRepaymentSchema.parse({
        body: { feeAmount: 0, interestAmount: 25, principalAmount: 75, totalPaymentAmount: 100 },
        params: { loanId: 1 },
        query: { transactionKey: 10 },
      }),
    ).toBeTruthy();
  });

  it('rejects repayment link bodies with mismatched allocations', () => {
    expect(() =>
      linkLoanRepaymentSchema.parse({
        body: { feeAmount: 0, interestAmount: 25, principalAmount: 75, totalPaymentAmount: 101 },
        params: { loanId: 1 },
        query: { transactionKey: 10 },
      }),
    ).toThrow();
  });

  it('rejects allocations over transaction amount', () => {
    expect(() =>
      { assertAllocationWithinTransactionAmount(101, { originalAmount: undefined, settlementAmount: -100 } as unknown as Transaction); },
    ).toThrow();
  });

  it('rejects principal above outstanding cap', () => {
    expect(() => { assertPrincipalWithinOutstanding(101, 100); }).toThrow();
  });
});
