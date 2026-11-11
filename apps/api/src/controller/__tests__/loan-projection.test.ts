import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import type { Household } from '@app/__tests__/__helpers__/finance-fixtures';
import { seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Loan } from '@entity/Loan';
import loanRoutes from '@route/loan';
import { LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** The next monthly instalment after today, so a fresh loan is on schedule. */
function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function nextPaymentDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15));
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/*
 * A loan's payoff projection belongs to one household. Another household asking for it gets
 * the same 404 as for a loan that does not exist. The projection starts from the outstanding
 * principal and pays the contract instalment plus whatever extra the query asks for.
 */
describe('GET /v1/loan/:loanId/projection', () => {
  const db = useTestDatabase();
  useRequestContextEm(db);
  const http = tenantHttp('/v1/loan', loanRoutes);

  async function addLoan(
    household: Household,
    overrides: Partial<{
      annualInterestRateBps: number;
      firstPaymentDate: Date;
      openingPrincipalBalance: number;
      originalPrincipal: number;
      regularPaymentAmount: number;
      termMonths: number;
    }> = {},
  ) {
    const em = db.em();
    const loan = em.create(Loan, {
      amortizationMethod: LoanAmortizationMethod.FRENCH,
      annualInterestRateBps: 'annualInterestRateBps' in overrides ? overrides.annualInterestRateBps : 1200,
      currencyKey: household.currency,
      firstPaymentDate: overrides.firstPaymentDate ?? nextPaymentDate(),
      name: 'Car loan',
      openingBalanceDate: day('2026-01-01'),
      openingPrincipalBalance: overrides.openingPrincipalBalance ?? 1_000,
      originalPrincipal: overrides.originalPrincipal ?? 1_000,
      ownerAppuserKey: household.appuser,
      paymentFrequency: LoanPaymentFrequency.MONTHLY,
      rateType: LoanRateType.FIXED,
      regularPaymentAmount: overrides.regularPaymentAmount,
      status: LoanStatus.ACTIVE,
      tenantKey: household.tenant,
      termMonths: 'termMonths' in overrides ? overrides.termMonths : 12,
      type: LoanType.AUTO_LOAN,
    }, { partial: true });
    await em.flush();
    return loan;
  }

  it("returns 404 for another household's loan", async () => {
    const ours = await seedHousehold(db.em());
    const theirs = await seedHousehold(db.em());
    const theirLoan = await addLoan(theirs);

    const response = await http.as(ours.appuser).get(`/v1/loan/${theirLoan.loanKey}/projection`);

    expect(response.status).toBe(404);
  });

  it("returns the projected payoff, savings and balance series for the household's own loan", async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);

    expect(response.status).toBe(200);
    expect(response.body.projection).toMatchObject({
      aheadOrBehindMonths: 0,
      interestSaved: 0,
      months: 12,
      monthsSaved: 0,
      payoffDate: isoDay(addMonths(nextPaymentDate(), 11)),
      paysOff: true,
      reason: null,
    });
    expect(response.body.projection.totalInterest).toBeGreaterThan(0);
    expect(response.body.projection.series).toHaveLength(13);
    expect(response.body.projection.series[0]).toMatchObject({ baselineBalance: 1_000, month: 0, withExtraBalance: 1_000 });
    expect(response.body.projection.series.at(-1)).toMatchObject({ baselineBalance: 0, withExtraBalance: 0 });
  });

  it('applies a monthly extra and reports the months and interest it saves', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);
    const baseline = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection?extra=100&frequency=monthly`);

    expect(response.status).toBe(200);
    expect(response.body.projection.months).toBeLessThan(baseline.body.projection.months);
    expect(response.body.projection.monthsSaved).toBe(baseline.body.projection.months - response.body.projection.months);
    expect(response.body.projection.interestSaved).toBeGreaterThan(0);
    expect(response.body.projection.payoffDate < baseline.body.projection.payoffDate).toBe(true);
  });

  it('applies a one-off extra from its start date', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);
    const baseline = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);
    const startDate = isoDay(addMonths(nextPaymentDate(), 3));

    const response = await http
      .as(household.appuser)
      .get(`/v1/loan/${loan.loanKey}/projection?extra=400&frequency=one-off&startDate=${startDate}`);

    expect(response.status).toBe(200);
    expect(response.body.projection.months).toBeLessThan(baseline.body.projection.months);
    expect(response.body.projection.interestSaved).toBeGreaterThan(0);
    const beforeStart = response.body.projection.series.filter((point: { date: string }) => point.date < `${startDate}T00:00:00.000Z`);
    expect(beforeStart.length).toBeGreaterThan(0);
    for (const point of beforeStart) expect(point.withExtraBalance).toBe(point.baselineBalance);
  });

  it('returns paysOff false with a reason when the stored payment does not cover interest', async () => {
    const household = await seedHousehold(db.em());
    // 1000 @ 24% APR => 20 monthly interest; a stored payment of 15 never clears it.
    const loan = await addLoan(household, { annualInterestRateBps: 2400, regularPaymentAmount: 15 });

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);

    expect(response.status).toBe(200);
    expect(response.body.projection).toMatchObject({
      months: null,
      payoffDate: null,
      paysOff: false,
      reason: 'PAYMENT_BELOW_INTEREST',
    });
  });

  it('returns 422 with a reason when the loan lacks the rate a projection needs', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household, { annualInterestRateBps: undefined });

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: 'loan_projection_unavailable',
      details: { reason: 'MISSING_INTEREST_RATE' },
    });
  });

  it('returns 422 when the loan lacks a term', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household, { termMonths: undefined });

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection`);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'loan_projection_unavailable', details: { reason: 'MISSING_TERM' } });
  });

  it('rejects a negative extra payment', async () => {
    const household = await seedHousehold(db.em());
    const loan = await addLoan(household);

    const response = await http.as(household.appuser).get(`/v1/loan/${loan.loanKey}/projection?extra=-1`);

    expect(response.status).toBe(400);
  });
});
