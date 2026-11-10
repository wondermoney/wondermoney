import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addTransaction, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import loanRoutes from '@route/loan';
import { LoanAllocationSource, LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/*
 * A loan belongs to one household, and its schedule is the contract's rows.
 * Another household asking for it gets the same 404 as for a loan that does
 * not exist; a linked repayment marks the row whose period contains it.
 */
describe('GET /v1/loan/:loanId/schedule', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/loan', loanRoutes);

  async function addLoan(
    household: Household,
    overrides: Partial<{
      amortizationMethod: LoanAmortizationMethod;
      annualInterestRateBps: number;
      firstPaymentDate: Date;
      openingPrincipalBalance: number;
      originalPrincipal: number;
      termMonths: number;
    }> = {},
  ) {
    const em = db.em();
    const loan = em.create(Loan, {
      amortizationMethod: overrides.amortizationMethod ?? LoanAmortizationMethod.FRENCH,
      annualInterestRateBps: 'annualInterestRateBps' in overrides ? overrides.annualInterestRateBps : 0,
      currencyKey: household.currency,
      firstPaymentDate: overrides.firstPaymentDate ?? day('2026-01-15'),
      name: 'Car loan',
      openingBalanceDate: day('2026-01-01'),
      openingPrincipalBalance: overrides.openingPrincipalBalance ?? 1_000,
      originalPrincipal: overrides.originalPrincipal,
      ownerAppuserKey: household.appuser,
      paymentFrequency: LoanPaymentFrequency.MONTHLY,
      rateType: LoanRateType.FIXED,
      status: LoanStatus.ACTIVE,
      tenantKey: household.tenant,
      termMonths: 'termMonths' in overrides ? overrides.termMonths : 3,
      type: LoanType.AUTO_LOAN,
    }, { partial: true });
    await em.flush();
    return loan;
  }

  it("returns 404 for another household's loan", async () => {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    const theirLoan = await addLoan(theirs);

    const response = await http.as(ours.appuser).get(`/v1/loan/${theirLoan.loanKey}/schedule`);

    expect(response.status).toBe(404);
  });

  it('returns the contract rows and totals for the household\'s own loan', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/schedule`);

    expect(response.status).toBe(200);
    expect(response.body.schedule).toMatchObject({
      totalInterest: 0,
      totalPaid: 1_000,
    });
    expect(response.body.schedule.rows).toHaveLength(3);
    expect(response.body.schedule.rows[0]).toMatchObject({
      date: '2026-01-15T00:00:00.000Z',
      endingBalance: 666.67,
      interest: 0,
      number: 1,
      paid: false,
      payment: 333.33,
      principal: 333.33,
    });
    expect(response.body.schedule.rows[2]).toMatchObject({
      endingBalance: 0,
      number: 3,
      payment: 333.34,
      principal: 333.34,
    });
  });

  it('marks the row whose period contains a linked repayment', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);
    const em = db.em();
    const transaction = await addTransaction(em, household, { amount: -333.33, date: day('2026-01-20'), status: 'BOOKED' });
    em.create(LoanRepaymentLink, {
      allocationSource: LoanAllocationSource.MANUAL,
      feeAmount: 0,
      interestAmount: 0,
      linkedByAppuserKey: household.appuser,
      loanKey: loan,
      paymentDate: day('2026-01-20'),
      principalAmount: 333.33,
      tenantKey: household.tenant,
      totalPaymentAmount: 333.33,
      transactionKey: transaction,
    }, { partial: true });
    await em.flush();

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/schedule`);

    expect(response.status).toBe(200);
    expect(response.body.schedule.rows.map((row: { paid: boolean }) => row.paid)).toEqual([true, false, false]);
  });

  it('returns 422 with a reason when the loan lacks the rate a schedule needs', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household, { annualInterestRateBps: undefined });

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/schedule`);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'loan_schedule_unavailable',
      details: { reason: 'MISSING_INTEREST_RATE' },
    });
  });

  it('returns 422 when the loan lacks a term', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household, { termMonths: undefined });

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/schedule`);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'loan_schedule_unavailable', details: { reason: 'MISSING_TERM' } });
  });
});
