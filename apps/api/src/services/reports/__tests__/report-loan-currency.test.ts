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
import type { Category } from '@entity/Category';
import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { FxStatus, type Transaction } from '@entity/Transaction';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';
import { getBudgetVsActualReport } from '@service/reports/budgetVsActual.service';
import { getSpendingByCategoryReport } from '@service/reports/spendingByCategory.service';
import { reportFiltersSchema } from '@validators/reports';

/*
 * Spending by category and budget vs actual count a loan repayment by its interest and fees only,
 * which are recorded in the loan's currency. They are converted into the report's currency at the
 * rate of the repayment's date, as the budget pages convert them; with no rate the repayment is
 * left out and counted, never added at face value. Every row left out names its currency.
 *
 * The household: the owner keeps EUR, the partner USD. Rates: 1 USD = 0.8 EUR from 2025-06-30 and
 * 0.5 EUR from 2025-07-20 (and the inverse, 1.25 then 2). The budget is in EUR.
 */
describe('reports: loan repayment costs and unconverted currencies', () => {
  const db = useTestDatabase();
  const july = (day: number) => new Date(Date.UTC(2025, 6, day, 12));
  const RANGE = { fromDate: '2025-07-01T00:00:00Z', timezone: 'UTC', toDate: '2025-07-31T23:59:59Z' };

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
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: eur, name: 'Home', numAdults: 2, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 500, budgetKey: budget, categoryKey: carLoan, month: 7, year: 2025 }, { partial: true });
    template.accounts.add(household.account, partnerAccount);
    await em.flush();

    const addLoan = async (owner: Appuser, currency: Currency) => {
      const loan = em.create(Loan, { currencyKey: currency, name: `Car ${currency.code}`, openingBalanceDate: new Date('2025-01-01'), openingPrincipalBalance: 5000, ownerAppuserKey: owner, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.AUTO_LOAN }, { partial: true });
      await em.flush();
      return loan;
    };

    /** A repayment from `account` in its owner's currency, linked to `loan` with interest and fees in the loan's currency. */
    const repay = async (input: { account: Account; amount: number; appuser: Appuser; currency: Currency; day: number; fee: number; interest: number; loan: Loan }): Promise<Transaction> => {
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

    /** A partner row in USD stored with no converted amount, as the sync writes one with no rate. */
    const addMissing = async (input: { amount: number; category: Category; day: number }) => {
      const row = await addTransaction(em, household, { account: partnerAccount, amount: input.amount, appuser: partner, category: input.category, currency: usd, date: july(input.day), status: 'BOOKED' });
      row.appuserSettlementAmount = null;
      row.fxStatus = FxStatus.MISSING;
      await em.flush();
      return row;
    };

    return { addLoan, addMissing, carLoan, em, eur, household, partner, partnerAccount, repay, usd };
  }

  const spendingByCategory = (household: Household, viewer: Appuser) =>
    getSpendingByCategoryReport({ filters: reportFiltersSchema.parse(RANGE), tenant: household.tenant, user: viewer });
  const budgetVsActual = (household: Household, viewer: Appuser) =>
    getBudgetVsActualReport({ filters: reportFiltersSchema.parse(RANGE), tenant: household.tenant, user: viewer });

  describe('spending by category', () => {
    it('adds a dollar loan\'s interest and fees in the viewer\'s currency, at each repayment\'s rate', async () => {
      const { addLoan, household, partner, partnerAccount, repay, usd } = await mixedHousehold();
      const loan = await addLoan(partner, usd);
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 22, fee: 0, interest: 20, loan });

      const owner = await spendingByCategory(household, household.appuser);
      const viewedByPartner = await spendingByCategory(household, partner);

      // 50 USD at 0.8 + 20 USD at 0.5.
      expect(owner.data).toEqual([expect.objectContaining({ name: 'Car loan', totalAmount: 50, transactionCount: 2 })]);
      expect(owner.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
      // Already in the partner's currency.
      expect(viewedByPartner.data).toEqual([expect.objectContaining({ totalAmount: 70 })]);
    });

    it('converts by the loan\'s currency, even when the repayment comes from a euro account', async () => {
      const { addLoan, eur, household, partner, repay, usd } = await mixedHousehold();
      const loan = await addLoan(household.appuser, usd);
      await repay({ account: household.account, amount: -240, appuser: household.appuser, currency: eur, day: 6, fee: 0, interest: 25, loan });

      expect((await spendingByCategory(household, household.appuser)).data).toEqual([expect.objectContaining({ totalAmount: 20 })]);
      // A USD viewer reads the USD interest as it is, not the EUR payment converted.
      expect((await spendingByCategory(household, partner)).data).toEqual([expect.objectContaining({ totalAmount: 25 })]);
    });

    it('leaves a repayment out and names the loan\'s currency when no rate converts it', async () => {
      const { addLoan, eur, household, repay, usd } = await mixedHousehold({ withRates: false });
      const loan = await addLoan(household.appuser, usd);
      await repay({ account: household.account, amount: -240, appuser: household.appuser, currency: eur, day: 6, fee: 0, interest: 25, loan });

      const result = await spendingByCategory(household, household.appuser);

      expect(result.data).toEqual([]);
      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });

    it('counts a repayment by its interest and fees even when the payment has no converted amount', async () => {
      const { addLoan, em, eur, household, partner, partnerAccount, repay, usd } = await mixedHousehold({ withRates: false });
      const loan = await addLoan(household.appuser, eur);
      const payment = await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 5, interest: 30, loan });
      payment.appuserSettlementAmount = null;
      payment.fxStatus = FxStatus.MISSING;
      await em.flush();

      const result = await spendingByCategory(household, household.appuser);

      expect(result.data).toEqual([expect.objectContaining({ totalAmount: 35 })]);
      expect(result.completeness).toMatchObject({ isComplete: true, unconvertedTransactions: 0 });
    });

    it('names the currencies of the expenses it leaves out', async () => {
      const { addMissing, carLoan, household } = await mixedHousehold({ withRates: false });
      await addMissing({ amount: -50, category: carLoan, day: 8 });
      await addTransaction(db.em(), household, { amount: -10, category: carLoan, date: july(9), status: 'BOOKED' });

      const result = await spendingByCategory(household, household.appuser);

      expect(result.data).toEqual([expect.objectContaining({ totalAmount: 10 })]);
      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });

    it('names the member\'s currency of a row no rate converts into the viewer\'s', async () => {
      const { carLoan, household, partner, partnerAccount, usd } = await mixedHousehold({ withRates: false });
      await addTransaction(db.em(), household, { account: partnerAccount, amount: -40, appuser: partner, category: carLoan, currency: usd, date: july(8), status: 'BOOKED' });

      const result = await spendingByCategory(household, household.appuser);

      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });
  });

  describe('budget vs actual', () => {
    it('adds a dollar loan\'s interest and fees to the euro budget in euros', async () => {
      const { addLoan, household, partner, partnerAccount, repay, usd } = await mixedHousehold();
      const loan = await addLoan(partner, usd);
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 22, fee: 0, interest: 20, loan });

      const result = await budgetVsActual(household, household.appuser);

      // 50 USD at 0.8 + 20 USD at 0.5, against 500 EUR budgeted.
      expect(result.data).toEqual([expect.objectContaining({ actual: 50, budgeted: 500, name: 'Car loan', variance: 450 })]);
      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: true, unconvertedCurrencies: [], unconvertedTransactions: 0 });
    });

    it('shows a member in another currency the budget in the budget\'s currency', async () => {
      const { addLoan, carLoan, household, partner, partnerAccount, repay, usd } = await mixedHousehold();
      const loan = await addLoan(partner, usd);
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });
      await addTransaction(db.em(), household, { amount: -100, category: carLoan, date: july(9), status: 'BOOKED' });

      const result = await budgetVsActual(household, partner);

      // The budgeted 500 is in EUR, so the actual is too: 50 USD at 0.8 + 100 EUR.
      expect(result.data).toEqual([expect.objectContaining({ actual: 140, budgeted: 500 })]);
      expect(result.completeness).toMatchObject({ currencyCode: 'EUR', isComplete: true });
    });

    it('leaves a repayment out and counts it when no rate converts the loan\'s currency', async () => {
      const { addLoan, household, partner, partnerAccount, repay, usd } = await mixedHousehold({ withRates: false });
      const loan = await addLoan(partner, usd);
      await repay({ account: partnerAccount, amount: -300, appuser: partner, currency: usd, day: 6, fee: 10, interest: 40, loan });

      const result = await budgetVsActual(household, household.appuser);

      expect(result.data).toEqual([expect.objectContaining({ actual: 0, budgeted: 500 })]);
      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });

    it('counts an expense with no converted amount instead of dropping it', async () => {
      const { addMissing, carLoan, household } = await mixedHousehold();
      await addMissing({ amount: -50, category: carLoan, day: 8 });

      const result = await budgetVsActual(household, household.appuser);

      expect(result.data).toEqual([expect.objectContaining({ actual: 0 })]);
      expect(result.completeness).toEqual({ currencyCode: 'EUR', isComplete: false, unconvertedCurrencies: ['USD'], unconvertedTransactions: 1 });
    });
  });
});
