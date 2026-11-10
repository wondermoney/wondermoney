import type { EntityManager } from '@mikro-orm/postgresql';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { FxStatus } from '@entity/Transaction';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

import { getCategorySpending } from '../transactions';

interface CategorySpendingBody {
  categorySpending: { amount: number; childCategories: { amount: number; currency?: string; name: string }[]; currency?: string; name: string; numTransactions: number }[];
  completeness: { currencyCode: string; isComplete: boolean; unconvertedCurrencies?: string[]; unconvertedTransactions: number };
}

type Handler = (req: Request, res: Response, next: () => void) => Promise<unknown>;

/*
 * Category spending on the accounts page adds every member's expenses, and a loan repayment by its
 * interest and fees only, which are in the loan's currency. Members keep their own currencies, so
 * every amount is converted into the viewer's currency at the rate of the transaction's date. With
 * no rate the row is left out and counted in `completeness`, never added at face value.
 *
 * The household: the owner keeps EUR, the partner USD. Rates: 1 USD = 0.8 EUR from 2025-06-30 and
 * 0.5 EUR from 2025-07-20 (and the inverse, 1.25 then 2).
 */
describe('category spending in the viewer\'s currency', () => {
  const db = useTestDatabase();
  const july = (day: number) => new Date(Date.UTC(2025, 6, day, 12));
  const RANGE = { fromDate: '2025-07-01T00:00:00Z', timezone: 'UTC', toDate: '2025-07-31T23:59:59Z' };

  async function categorySpending(viewer: Appuser, household: Household): Promise<CategorySpendingBody> {
    let body: unknown;
    const res = { json: (payload: unknown) => { body = payload; return res; }, status: vi.fn(() => res) } as unknown as Response;
    const req = { body: {}, headers: {}, params: {}, query: RANGE, tenant: household.tenant, user: viewer } as unknown as Request;
    await (getCategorySpending as Handler)(req, res, () => undefined);
    return body as CategorySpendingBody;
  }

  async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: string) {
    em.create(ExchangeRate, { date: new Date(`${date}T00:00:00Z`), fromCurrency: from, rate, toCurrency: to }, { partial: true });
    await em.flush();
  }

  async function mixedHousehold(input: { withRates?: boolean } = {}) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, name: 'Checking', owner: partner });
    if (input.withRates ?? true) {
      await addRate(em, usd, eur, 0.8, '2025-06-30');
      await addRate(em, usd, eur, 0.5, '2025-07-20');
      await addRate(em, eur, usd, 1.25, '2025-06-30');
      await addRate(em, eur, usd, 2, '2025-07-20');
    }
    const loans = await addCategory(em, household, 'Loans');
    const carLoan = await addCategory(em, household, 'Car loan', loans);
    const food = await addCategory(em, household, 'Food');

    const addLoan = async (owner: Appuser, currency: Currency) => {
      const loan = em.create(Loan, { currencyKey: currency, name: `Car ${currency.code}`, openingBalanceDate: new Date('2025-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
      await em.flush();
      return loan;
    };

    /** A repayment from `account` in its owner's currency, linked to `loan` with interest and fees in the loan's currency. */
    const repay = async (input: { account: Account; amount: number; appuser: Appuser; currency: Currency; day: number; fee: number; interest: number; loan: Loan }) => {
      const transaction = await addTransaction(em, household, { account: input.account, amount: input.amount, appuser: input.appuser, category: carLoan, currency: input.currency, date: july(input.day), status: 'BOOKED' });
      em.create(LoanRepaymentLink, {
        allocationSource: LoanAllocationSource.MANUAL,
        feeAmount: input.fee,
        interestAmount: input.interest,
        linkedByAppuserKey: input.appuser,
        loanKey: input.loan,
        paymentDate: july(input.day),
        principalAmount: Math.abs(input.amount) - input.interest - input.fee,
        tenantKey: household.tenant,
        totalPaymentAmount: Math.abs(input.amount),
        transactionKey: transaction,
      }, { partial: true });
      await em.flush();
      return transaction;
    };

    return { addLoan, carLoan, em, eur, food, household, partner, partnerAccount, repay, usd };
  }

  it('adds a dollar loan\'s interest and fees to a euro viewer\'s spending at each repayment\'s rate', async () => {
    const { addLoan, household, partner, partnerAccount, repay, usd } = await mixedHousehold();
    const loan = await addLoan(partner, usd);
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 22, fee: 0, interest: 20, loan });

    const body = await categorySpending(household.appuser, household);

    // 50 USD at 0.8 + 20 USD at 0.5.
    expect(body.categorySpending).toEqual([
      expect.objectContaining({ amount: 50, childCategories: [expect.objectContaining({ amount: 50, currency: 'EUR', name: 'Car loan' })], currency: 'EUR', name: 'Loans', numTransactions: 2 }),
    ]);
    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('converts a dollar loan repaid from a euro account by the loan\'s currency', async () => {
    const { addLoan, eur, household, partner, repay, usd } = await mixedHousehold();
    const loan = await addLoan(household.appuser, usd);
    await repay({ account: household.account, amount: -240, appuser: household.appuser, currency: eur, day: 6, fee: 5, interest: 20, loan });

    // 25 USD at 0.8 for the owner; the partner reads the USD interest and fees as they are.
    expect((await categorySpending(household.appuser, household)).categorySpending).toEqual([expect.objectContaining({ amount: 20, currency: 'EUR' })]);
    expect((await categorySpending(partner, household)).categorySpending).toEqual([expect.objectContaining({ amount: 25, currency: 'USD' })]);
  });

  it('leaves a repayment out and names the loan\'s currency when no rate converts it', async () => {
    const { addLoan, eur, food, household, repay, usd } = await mixedHousehold({ withRates: false });
    const loan = await addLoan(household.appuser, usd);
    await repay({ account: household.account, amount: -240, appuser: household.appuser, currency: eur, day: 6, fee: 0, interest: 25, loan });
    await addTransaction(db.em(), household, { amount: -10, category: food, date: july(9), status: 'BOOKED' });

    const body = await categorySpending(household.appuser, household);

    expect(body.categorySpending).toEqual([expect.objectContaining({ amount: 10, name: 'Food' })]);
    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });

  it('converts the partner\'s dollar expenses into the owner\'s euros instead of adding dollars to euros', async () => {
    const { food, household, partner, partnerAccount, usd } = await mixedHousehold();
    await addTransaction(db.em(), household, { account: partnerAccount, amount: -40, appuser: partner, category: food, currency: usd, date: july(8), status: 'BOOKED' });
    await addTransaction(db.em(), household, { amount: -10, category: food, date: july(9), status: 'BOOKED' });
    // Money in is not spending.
    await addTransaction(db.em(), household, { account: partnerAccount, amount: 500, appuser: partner, category: food, currency: usd, date: july(10), status: 'BOOKED' });

    const body = await categorySpending(household.appuser, household);

    // 40 USD at 0.8 + 10 EUR.
    expect(body.categorySpending).toEqual([expect.objectContaining({ amount: 42, currency: 'EUR', name: 'Food', numTransactions: 2 })]);
  });

  it('shows the partner the owner\'s dollar expense at its exact dollar amount, not converted to euros and back', async () => {
    const { em, eur, food, household, partner, usd } = await mixedHousehold();
    // The owner paid 40 USD, stored as 33 EUR at the rate of the day it was written.
    const row = await addTransaction(em, household, { amount: -33, category: food, currency: eur, date: july(8), status: 'BOOKED' });
    row.settlementAmount = -40;
    row.settlementCurrencyKey = usd;
    await em.flush();

    const body = await categorySpending(partner, household);

    // Not 33 EUR at 1.25 (41.25).
    expect(body.categorySpending).toEqual([expect.objectContaining({ amount: 40, currency: 'USD', name: 'Food', numTransactions: 1 })]);
    expect(body.completeness).toEqual({ currencyCode: 'USD', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('counts an expense with no converted amount instead of dropping it', async () => {
    const { em, food, household, partner, partnerAccount, usd } = await mixedHousehold();
    const row = await addTransaction(em, household, { account: partnerAccount, amount: -40, appuser: partner, category: food, currency: usd, date: july(8), status: 'BOOKED' });
    row.appuserSettlementAmount = null;
    row.fxStatus = FxStatus.MISSING;
    await em.flush();

    const body = await categorySpending(household.appuser, household);

    expect(body.categorySpending).toEqual([]);
    expect(body.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });
});
