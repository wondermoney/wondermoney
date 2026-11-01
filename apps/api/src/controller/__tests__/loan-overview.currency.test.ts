import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Loan } from '@entity/Loan';
import { LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getLoanOverview } from '../loan';

const DAY = 24 * 60 * 60 * 1000;

/*
 * The loan overview totals the user's loans in the user's currency: a loan in another currency is
 * converted at the latest rate published on or before today, and one with no rate is left out and
 * counted.
 */
describe('loan overview currencies', () => {
  const db = useTestDatabase();

  async function overview(household: Household) {
    let body: Record<string, unknown> | undefined;
    const res = { json: (payload: Record<string, unknown>) => { body = payload; return res; } } as unknown as Response;
    await getLoanOverview({ headers: {}, params: {}, query: {}, user: household.appuser } as unknown as Request, res);
    return body?.['overview'];
  }

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    const currency = async (code: string, num: string) => (await em.findOne(Currency, { code })) ?? em.create(Currency, { code, num }, { partial: true });
    const gbp = await currency('GBP', '826');
    const usd = await currency('USD', '840');
    const loan = (name: string, loanCurrency: Currency, principal: number, payment: number, includeInNetWorth = true) =>
      em.create(Loan, { currencyKey: loanCurrency, includeInNetWorth, name, openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: principal, ownerAppuserKey: household.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, regularPaymentAmount: payment, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
    const rate = (from: Currency, to: Currency, value: number, date: Date) => em.create(ExchangeRate, { date, fromCurrency: from, rate: value, toCurrency: to }, { partial: true });
    const now = Date.now();
    rate(gbp, household.currency, 1.1, new Date(now - 30 * DAY));
    rate(gbp, household.currency, 1.15, new Date(now - 2 * DAY));
    // Published for a later day: not a rate for today.
    rate(gbp, household.currency, 2, new Date(now + 5 * DAY));
    await em.flush();
    return { em, gbp, household, loan, usd };
  }

  it('converts a loan in another currency at the latest rate before summing', async () => {
    const { em, gbp, household, loan } = await seed();
    loan('Car', household.currency, 10_000, 300);
    loan('UK card', gbp, 2_000, 100);
    await em.flush();

    await expect(overview(household)).resolves.toMatchObject({ currency: 'EUR', monthlyRepaymentTotal: 415, netWorthImpact: -12_300, totalOutstandingDebt: 12_300, unconvertedLoanCount: 0 });
  });

  it('leaves out and counts a loan whose currency has no rate', async () => {
    const { em, household, loan, usd } = await seed();
    loan('Car', household.currency, 10_000, 300);
    loan('US loan', usd, 5_000, 200);
    await em.flush();

    await expect(overview(household)).resolves.toMatchObject({ currency: 'EUR', monthlyRepaymentTotal: 300, netWorthImpact: -10_000, totalOutstandingDebt: 10_000, unconvertedLoanCount: 1 });
  });

  it('keeps a converted loan left out of net worth out of the net-worth impact only', async () => {
    const { em, gbp, household, loan } = await seed();
    loan('Car', household.currency, 10_000, 300);
    loan('UK card', gbp, 2_000, 100, false);
    await em.flush();

    await expect(overview(household)).resolves.toMatchObject({ monthlyRepaymentTotal: 415, netWorthImpact: -10_000, totalOutstandingDebt: 12_300 });
  });
});
