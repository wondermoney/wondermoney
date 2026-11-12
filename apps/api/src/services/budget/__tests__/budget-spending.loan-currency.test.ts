import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));
vi.mock('../../../app.js', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addAccount, addCategory, addPartner, addTransaction, currencyFor, type Household, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import type { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { getMonthRollover } from '@service/budget/budget-rollover.service';
import { getBudgetSpending } from '@service/budget/spending';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

async function addLoan(em: EntityManager, household: Household, owner: Appuser, currency: Currency) {
  const loan = em.create(Loan, { currencyKey: currency, name: `Car ${currency.code}`, openingBalanceDate: new Date('2025-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
  await em.flush();
  return loan;
}

async function addRate(em: EntityManager, from: Currency, to: Currency, rate: number, date: string) {
  em.create(ExchangeRate, { date: new Date(`${date}T00:00:00Z`), fromCurrency: from, rate, toCurrency: to }, { partial: true });
  await em.flush();
}

/*
 * A loan repayment counts in a budget by its interest and fees only (the principal pays the loan
 * down). Those are recorded in the loan's currency, which need not be the budget's: in a household
 * whose partner keeps USD, a dollar loan's interest is converted into the euro budget at the rate
 * of the repayment's date. With no rate it is left out and counted in `completeness`, never added
 * at face value.
 *
 * Rates: 1 USD = 0.8 EUR from 2025-06-30, 0.5 EUR from 2025-07-20.
 */
describe('budget spending: loan repayments in another currency', () => {
  const db = useTestDatabase();
  const july = (day: number) => new Date(Date.UTC(2025, 6, day, 12));

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
    }
    const loans = await addCategory(em, household, 'Loans');
    const carLoan = await addCategory(em, household, 'Car loan', loans);
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: eur, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: carLoan, month: 7, year: 2025 }, { partial: true });
    template.accounts.add(household.account, partnerAccount);
    await em.flush();

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
    };

    const spending = async () => {
      const result = await getBudgetSpending({
        accountKeys: [household.account.accountKey, partnerAccount.accountKey],
        currency: { code: 'EUR', currencyKey: eur.currencyKey },
        period: 'monthly',
        periodStartDay: 1,
        templateKeys: [template.budgetTemplateCategoryKey],
        tenantKey: household.tenant.tenantKey,
        viewerAppuserKey: household.appuser.appuserKey,
      });
      const row = result.categories.find((category) => category.child_category_name === 'Car loan');
      return { amount: Number(row?.category_amount), completeness: result.completeness };
    };

    return { em, eur, household, partner, partnerAccount, repay, spending, usd };
  }

  it('adds a dollar loan\'s interest and fees to the euro budget in euros', async () => {
    const { em, household, partner, partnerAccount, repay, spending, usd } = await mixedHousehold();
    const loan = await addLoan(em, household, partner, usd);
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });

    const { amount, completeness } = await spending();

    // (40 + 10) USD at 0.8.
    expect(amount).toBe(40);
    expect(completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
  });

  it('converts each repayment at the rate of its own date', async () => {
    const { em, household, partner, partnerAccount, repay, spending, usd } = await mixedHousehold();
    const loan = await addLoan(em, household, partner, usd);
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 22, fee: 0, interest: 20, loan });

    const { amount } = await spending();

    // 50 USD at 0.8 + 20 USD at 0.5.
    expect(amount).toBe(50);
  });

  it('converts by the loan\'s currency, even when the repayment comes from a euro account', async () => {
    const { em, eur, household, repay, spending, usd } = await mixedHousehold();
    const loan = await addLoan(em, household, household.appuser, usd);
    await repay({ account: household.account, amount: -240, appuser: household.appuser, currency: eur, day: 6, fee: 0, interest: 25, loan });

    const { amount } = await spending();

    expect(amount).toBe(20);
  });

  it('adds a euro loan\'s interest as it is', async () => {
    const { em, eur, household, partner, partnerAccount, repay, spending, usd } = await mixedHousehold({ withRates: false });
    const loan = await addLoan(em, household, household.appuser, eur);
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 5, interest: 30, loan });

    const { amount, completeness } = await spending();

    expect(amount).toBe(35);
    expect(completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
  });

  it('leaves a repayment out and counts it when no rate converts the loan\'s currency', async () => {
    const { em, household, partner, partnerAccount, repay, spending, usd } = await mixedHousehold({ withRates: false });
    const loan = await addLoan(em, household, partner, usd);
    await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });

    const { amount, completeness } = await spending();

    expect(amount).toBe(0);
    expect(completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
  });
});

/*
 * Rollover carries a month's leftover from that month's spending as the budget shows it, so a
 * repayment of a dollar loan in June counts its interest and fees in euros there too. With no rate
 * the June spending is incomplete, and so is the carry it leaves July.
 */
describe('budget rollover: loan repayments in another currency', () => {
  const db = useTestDatabase();

  async function carriedIntoJuly(input: { withRate: boolean }) {
    const em = db.em();
    const household = await seedHousehold(em);
    const eur = household.currency;
    const usd = await currencyFor(em, 'USD');
    const partner = await addPartner(em, household, { currency: usd });
    const partnerAccount = await addAccount(em, household, { currency: usd, name: 'Checking', owner: partner });
    if (input.withRate) await addRate(em, usd, eur, 0.8, '2025-05-30');
    const loans = await addCategory(em, household, 'Loans');
    const carLoan = await addCategory(em, household, 'Car loan', loans);
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: eur, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const rows = [6, 7].map((month) => {
      const row = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: carLoan, month, rolloverEnabled: true, year: 2025 }, { partial: true });
      row.accounts.add(household.account, partnerAccount);
      return row;
    });
    await em.flush();

    const loan = await addLoan(em, household, partner, usd);
    const paidOn = new Date(Date.UTC(2025, 5, 6, 12));
    const transaction = await addTransaction(em, household, { account: partnerAccount, amount: -300, appuser: partner, category: carLoan, currency: usd, date: paidOn, status: 'BOOKED' });
    em.create(LoanRepaymentLink, {
      allocationSource: LoanAllocationSource.MANUAL,
      feeAmount: 10,
      interestAmount: 40,
      linkedByAppuserKey: partner,
      loanKey: loan,
      paymentDate: paidOn,
      principalAmount: 250,
      tenantKey: household.tenant,
      totalPaymentAmount: 300,
      transactionKey: transaction,
    }, { partial: true });
    await em.flush();

    const rollover = await getMonthRollover({
      carryOverspend: true,
      currency: { code: 'EUR', currencyKey: eur.currencyKey },
      month: 7,
      periodStartDay: 1,
      rows: rows.map((row) => ({
        accountKeys: [household.account.accountKey, partnerAccount.accountKey],
        amountBudgeted: 500,
        budgetTemplateCategoryKey: row.budgetTemplateCategoryKey,
        categoryKey: carLoan.categoryKey,
        month: row.month,
        rolloverEnabled: true,
        year: 2025,
      })),
      tenantKey: household.tenant.tenantKey,
      viewerAppuserKey: household.appuser.appuserKey,
      year: 2025,
    });
    return rollover.get(carLoan.categoryKey);
  }

  it('carries what is left after the repayment\'s interest and fees, converted into euros', async () => {
    const july = await carriedIntoJuly({ withRate: true });

    // 500 - (40 + 10) USD at 0.8.
    expect(july).toMatchObject({ available: 960, rolledOver: 460, rolledOverIncomplete: false });
  });

  it('marks the carry incomplete when no rate converts the loan\'s currency', async () => {
    const july = await carriedIntoJuly({ withRate: false });

    expect(july).toMatchObject({ rolledOver: 500, rolledOverIncomplete: true });
  });
});
