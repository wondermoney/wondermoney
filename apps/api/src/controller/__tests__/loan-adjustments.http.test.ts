import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('@service/auth/better-auth', async () => (await import('@app/__tests__/__helpers__/auth-session-double')).mockAuthSession());

import { addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { tenantHttp, useRequestContextEm } from '@app/__tests__/__helpers__/tenant-http';
import { Loan } from '@entity/Loan';
import { LoanAdjustment } from '@entity/LoanAdjustment';
import { LoanRatePeriod } from '@entity/LoanRatePeriod';
import loanRoutes from '@route/loan';
import { LoanAmortizationMethod, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

describe('loan adjustments and rate periods HTTP', () => {
  const db = useTestDatabase({ postgresUrl: process.env['TEST_POSTGRES_URL'], schema: 'migrations' });
  useRequestContextEm(db);
  const http = tenantHttp('/v1/loan', loanRoutes);

  async function addLoan(household: Awaited<ReturnType<typeof seedHousehold>>, rate = 500) {
    const em = db.em();
    const loan = em.create(Loan, {
      amortizationMethod: LoanAmortizationMethod.FRENCH,
      annualInterestRateBps: rate,
      currencyKey: household.currency,
      includeInNetWorth: true,
      name: 'Mortgage',
      openingBalanceDate: new Date('2026-01-01T00:00:00Z'),
      openingPrincipalBalance: 1000,
      ownerAppuserKey: household.appuser,
      paymentFrequency: LoanPaymentFrequency.MONTHLY,
      rateType: LoanRateType.VARIABLE,
      status: LoanStatus.ACTIVE,
      tenantKey: household.tenant,
      type: LoanType.MORTGAGE,
    }, { partial: true });
    await em.flush();
    return loan;
  }

  async function addUnknownRateLoan(household: Awaited<ReturnType<typeof seedHousehold>>) {
    const em = db.em();
    const loan = em.create(Loan, {
      amortizationMethod: LoanAmortizationMethod.FRENCH,
      currencyKey: household.currency,
      includeInNetWorth: true,
      name: 'Unknown-rate loan',
      openingBalanceDate: new Date('2026-01-01T00:00:00Z'),
      openingPrincipalBalance: 1000,
      ownerAppuserKey: household.appuser,
      paymentFrequency: LoanPaymentFrequency.MONTHLY,
      rateType: LoanRateType.VARIABLE,
      status: LoanStatus.ACTIVE,
      tenantKey: household.tenant,
      type: LoanType.MORTGAGE,
    }, { partial: true });
    await em.flush();
    return loan;
  }

  it('scopes CRUD to the owning tenant and parent loan, and recomputes corrections on edit/delete', async () => {
    const owner = await seedHousehold(db.em());
    const other = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const foreignLoan = await addLoan(other);
    const payment = await addTransaction(db.em(), owner, { amount: -50, date: new Date('2026-03-10T00:00:00Z'), status: 'BOOKED' });
    const linked = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/repayments/link?transactionKey=${payment.transactionKey}`).send({ feeAmount: 0, interestAmount: 0, principalAmount: 50, totalPaymentAmount: 50 });
    expect(linked.status).toBe(201);

    const created = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 700, effectiveDate: '2026-03-01', type: 'BALANCE_CORRECTION' });
    expect(created.status).toBe(201);
    expect(created.body.outstandingPrincipal).toBe(650);
    const id = created.body.adjustment.loanAdjustmentKey as number;

    const listed = await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}/adjustments`);
    expect(listed.body.adjustments).toEqual([
      { amount: 700, effectiveDate: '2026-03-01T00:00:00.000Z', loanAdjustmentKey: id, reason: null, type: 'BALANCE_CORRECTION' },
    ]);
    const edit = await http.as(owner.appuser).patch(`/v1/loan/${loan.loanKey}/adjustments/${id}`).send({ amount: 800 });
    expect(edit.status).toBe(200);
    expect(edit.body.outstandingPrincipal).toBe(750);
    const removed = await http.as(owner.appuser).delete(`/v1/loan/${loan.loanKey}/adjustments/${id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.outstandingPrincipal).toBe(950);

    expect((await http.as(owner.appuser).get(`/v1/loan/${foreignLoan.loanKey}/adjustments`)).status).toBe(404);
    expect((await http.as(owner.appuser).patch(`/v1/loan/${foreignLoan.loanKey}/adjustments/${id}`).send({ amount: 9 })).status).toBe(404);
    expect((await http.as(owner.appuser).delete(`/v1/loan/${foreignLoan.loanKey}/adjustments/${id}`)).status).toBe(404);
    expect((await http.as(other.appuser).get(`/v1/loan/${loan.loanKey}/adjustments`)).status).toBe(404);
  });

  it('validates correction amounts and rate dates, scopes rate IDs, and keeps the current rate independent of future periods', async () => {
    const owner = await seedHousehold(db.em());
    const other = await seedHousehold(db.em());
    const loan = await addLoan(owner, 500);
    const foreignLoan = await addLoan(other);
    const date = '2026-12-01';

    expect((await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 0, effectiveDate: date, type: 'FEE' })).status).toBe(400);
    expect((await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: -1, effectiveDate: date, type: 'BALANCE_CORRECTION' })).status).toBe(400);
    const zeroCorrection = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 0, effectiveDate: date, type: 'BALANCE_CORRECTION' });
    expect(zeroCorrection.status).toBe(201);

    const future = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/rate-periods`).send({ annualInterestRateBps: 900, effectiveDate: '2027-01-01' });
    expect(future.status).toBe(201);
    expect(future.body.annualInterestRateBps).toBe(500);
    expect((await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}`)).body.loan.annualInterestRateBps).toBe(500);
    expect((await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/rate-periods`).send({ annualInterestRateBps: 800, effectiveDate: '2027-01-01' })).status).toBe(409);

    const current = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/rate-periods`).send({ annualInterestRateBps: 700, effectiveDate: '2026-01-01' });
    expect(current.status).toBe(201);
    const rateId = current.body.ratePeriod.loanRatePeriodKey as number;
    expect(current.body.annualInterestRateBps).toBe(700);
    expect(current.body.ratePeriod).toEqual({ annualInterestRateBps: 700, effectiveDate: '2026-01-01T00:00:00.000Z', loanRatePeriodKey: rateId });
    // Today's rate comes from the history; the loan's own rate stays the one before it.
    expect((await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}`)).body.loan).toMatchObject({ annualInterestRateBps: 700, initialAnnualInterestRateBps: 500 });
    expect((await http.as(owner.appuser).get(`/v1/loan/${foreignLoan.loanKey}/rate-periods`)).status).toBe(404);
    expect((await http.as(owner.appuser).patch(`/v1/loan/${foreignLoan.loanKey}/rate-periods/${rateId}`).send({ annualInterestRateBps: 1000 })).status).toBe(404);
    expect((await http.as(other.appuser).delete(`/v1/loan/${loan.loanKey}/rate-periods/${rateId}`)).status).toBe(404);

    const edit = await http.as(owner.appuser).patch(`/v1/loan/${loan.loanKey}/rate-periods/${rateId}`).send({ annualInterestRateBps: 650 });
    expect(edit.body.annualInterestRateBps).toBe(650);
    const deleted = await http.as(owner.appuser).delete(`/v1/loan/${loan.loanKey}/rate-periods/${rateId}`);
    expect(deleted.body.annualInterestRateBps).toBe(500);
    expect(await db.em().count(LoanRatePeriod, { deletedAt: undefined, loanKey: loan })).toBe(1);
  });

  it('returns ordered adjustment history and applies dated balance events before later repayments', async () => {
    const owner = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const first = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 25, effectiveDate: '2026-03-01', reason: 'Origination fee', type: 'FEE' });
    expect(first.status).toBe(201);
    expect(first.body.outstandingPrincipal).toBe(1025);
    const firstId = first.body.adjustment.loanAdjustmentKey as number;
    const second = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 100, effectiveDate: '2026-02-01', reason: 'Additional principal', type: 'PRINCIPAL_INCREASE' });
    expect(second.status).toBe(201);
    expect(second.body.outstandingPrincipal).toBe(1125);
    const secondId = second.body.adjustment.loanAdjustmentKey as number;

    const edited = await http.as(owner.appuser).patch(`/v1/loan/${loan.loanKey}/adjustments/${firstId}`).send({ amount: 30, effectiveDate: '2026-01-15', reason: 'Corrected fee date', type: 'CAPITALIZED_INTEREST' });
    expect(edited.status).toBe(200);
    expect(edited.body.adjustment).toMatchObject({ amount: 30, reason: 'Corrected fee date', type: 'CAPITALIZED_INTEREST' });
    expect(edited.body.outstandingPrincipal).toBe(1130);
    const listed = await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}/adjustments`);
    expect(listed.status).toBe(200);
    expect(listed.body.adjustments.map(({ amount, effectiveDate, loanAdjustmentKey, reason, type }: LoanAdjustment) => ({ amount, effectiveDate: new Date(effectiveDate).toISOString().slice(0, 10), loanAdjustmentKey, reason, type }))).toEqual([
      { amount: 30, effectiveDate: '2026-01-15', loanAdjustmentKey: firstId, reason: 'Corrected fee date', type: 'CAPITALIZED_INTEREST' },
      { amount: 100, effectiveDate: '2026-02-01', loanAdjustmentKey: secondId, reason: 'Additional principal', type: 'PRINCIPAL_INCREASE' },
    ]);

    const payment = await addTransaction(db.em(), owner, { amount: -50, date: new Date('2026-03-10T00:00:00Z'), status: 'BOOKED' });
    const linked = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/repayments/link?transactionKey=${payment.transactionKey}`).send({ feeAmount: 0, interestAmount: 0, principalAmount: 50, totalPaymentAmount: 50 });
    expect(linked.status).toBe(201);
    expect((await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}`)).body.loan.outstandingPrincipal).toBe(1080);
  });

  it('rejects invalid adjustment and rate dates and rates outside basis-point bounds', async () => {
    const owner = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const adjustments = `/v1/loan/${loan.loanKey}/adjustments`;
    const periods = `/v1/loan/${loan.loanKey}/rate-periods`;
    expect((await http.as(owner.appuser).post(adjustments).send({ amount: 1, effectiveDate: 'not-a-date', type: 'FEE' })).status).toBe(400);
    expect((await http.as(owner.appuser).post(adjustments).send({ amount: 1, effectiveDate: '2026-02-30', type: 'FEE' })).status).toBe(400);
    expect((await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: -1, effectiveDate: '2026-01-01' })).status).toBe(400);
    expect((await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 10_001, effectiveDate: '2026-01-01' })).status).toBe(400);
    expect((await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 500, effectiveDate: '2026-02-30' })).status).toBe(400);
  });

  it('ignores future balance changes in today\'s outstanding principal', async () => {
    const owner = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const adjustment = await http.as(owner.appuser).post(`/v1/loan/${loan.loanKey}/adjustments`).send({ amount: 0, effectiveDate: '2100-01-01', type: 'BALANCE_CORRECTION' });

    expect(adjustment.status).toBe(201);
    expect(adjustment.body.outstandingPrincipal).toBe(1000);
    expect((await http.as(owner.appuser).get(`/v1/loan/${loan.loanKey}`)).body.loan.outstandingPrincipal).toBe(1000);
  });

  it('checks a repayment against the balance on its own date, not after a later correction to zero', async () => {
    const owner = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const loanPath = `/v1/loan/${loan.loanKey}`;
    const link = (transactionKey: number, principalAmount: number) => http.as(owner.appuser)
      .post(`${loanPath}/repayments/link?transactionKey=${transactionKey}`)
      .send({ feeAmount: 0, interestAmount: 0, principalAmount, totalPaymentAmount: principalAmount });
    expect((await http.as(owner.appuser).post(`${loanPath}/adjustments`).send({ amount: 0, effectiveDate: '2026-03-01', type: 'BALANCE_CORRECTION' })).status).toBe(201);

    const february = await addTransaction(db.em(), owner, { amount: -100, date: new Date('2026-02-10T00:00:00Z'), status: 'BOOKED' });
    const linked = await link(february.transactionKey, 100);
    expect(linked.status).toBe(201);
    // The March correction replaces the balance; the February repayment before it is not taken again.
    expect((await http.as(owner.appuser).get(loanPath)).body.loan.outstandingPrincipal).toBe(0);

    // Editing it is checked on 10 Feb without itself: 1000 was owed then.
    const repaymentId = linked.body.repayment.loanRepaymentLinkKey as number;
    expect((await http.as(owner.appuser).patch(`${loanPath}/repayments/${repaymentId}`).send({ interestAmount: 10, principalAmount: 90 })).status).toBe(200);
    expect((await http.as(owner.appuser).get(loanPath)).body.loan.outstandingPrincipal).toBe(0);

    // More than was owed on its date, or anything after the correction to zero, is refused.
    const tooMuch = await addTransaction(db.em(), owner, { amount: -1001, date: new Date('2026-02-11T00:00:00Z'), status: 'BOOKED' });
    expect((await link(tooMuch.transactionKey, 1001)).status).toBe(400);
    const april = await addTransaction(db.em(), owner, { amount: -1, date: new Date('2026-04-10T00:00:00Z'), status: 'BOOKED' });
    expect((await link(april.transactionKey, 1)).status).toBe(400);
  });

  it('allows reuse of soft-deleted rate dates but rejects a duplicate active date', async () => {
    const owner = await seedHousehold(db.em());
    const loan = await addLoan(owner);
    const periods = `/v1/loan/${loan.loanKey}/rate-periods`;
    const first = await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 600, effectiveDate: '2026-05-01' });
    expect(first.status).toBe(201);
    const firstId = first.body.ratePeriod.loanRatePeriodKey as number;
    expect((await http.as(owner.appuser).delete(`${periods}/${firstId}`)).status).toBe(200);
    const recreated = await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 700, effectiveDate: '2026-05-01' });
    expect(recreated.status).toBe(201);
    expect((await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 800, effectiveDate: '2026-05-01' })).status).toBe(409);
    expect((await http.as(owner.appuser).delete(`${periods}/${recreated.body.ratePeriod.loanRatePeriodKey as number}`)).status).toBe(200);
    const movable = await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 800, effectiveDate: '2026-05-02' });
    const moved = await http.as(owner.appuser).patch(`${periods}/${movable.body.ratePeriod.loanRatePeriodKey as number}`).send({ effectiveDate: '2026-05-01' });
    expect(moved.status).toBe(200);
    expect((await http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 900, effectiveDate: '2026-05-01' })).status).toBe(409);
    const concurrent = await Promise.all([
      http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 900, effectiveDate: '2026-07-01' }),
      http.as(owner.appuser).post(periods).send({ annualInterestRateBps: 1000, effectiveDate: '2026-07-01' }),
    ]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([201, 409]);
  });

  it('preserves an unknown rate with no history and with future-only history, while retaining explicit zero', async () => {
    const owner = await seedHousehold(db.em());
    const unknown = await addUnknownRateLoan(owner);
    expect((await http.as(owner.appuser).get(`/v1/loan/${unknown.loanKey}`)).body.loan.annualInterestRateBps).toBeNull();
    const future = await http.as(owner.appuser).post(`/v1/loan/${unknown.loanKey}/rate-periods`).send({ annualInterestRateBps: 900, effectiveDate: '2100-01-01' });
    expect(future.status).toBe(201);
    expect(future.body.annualInterestRateBps).toBeNull();
    expect((await http.as(owner.appuser).get(`/v1/loan/${unknown.loanKey}`)).body.loan.annualInterestRateBps).toBeNull();

    const zero = await addLoan(owner, 0);
    expect((await http.as(owner.appuser).get(`/v1/loan/${zero.loanKey}`)).body.loan.annualInterestRateBps).toBe(0);

    const known = await http.as(owner.appuser).post(`/v1/loan/${unknown.loanKey}/rate-periods`).send({ annualInterestRateBps: 450, effectiveDate: '2026-01-01' });
    expect(known.body.annualInterestRateBps).toBe(450);
    expect((await http.as(owner.appuser).get(`/v1/loan/${unknown.loanKey}`)).body.loan).toMatchObject({ annualInterestRateBps: 450, initialAnnualInterestRateBps: null });
  });
});
