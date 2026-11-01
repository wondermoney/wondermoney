import { describe, expect, it, vi } from 'vitest';

import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { LoanAllocationSource, LoanPaymentFrequency, LoanRateType, LoanStatus, LoanType } from '@service/loan/loan-types';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { getBudgetSpending } from '../spending';

/*
 * Budget spending is money out of the category, net of refunds. A loan repayment counts only its
 * interest and fees (the principal is a transfer to the loan), and those are spending too.
 */
describe('budget spending signs', () => {
  const db = useTestDatabase();
  const JULY_15 = new Date('2026-07-15T12:00:00Z');

  async function seedBudget() {
    const em = db.em();
    const household = await seedHousehold(em);
    const housing = await addCategory(em, household, 'Mortgage', await addCategory(em, household, 'Housing'));
    const budget = em.create(Budget, { appuserKey: household.appuser, currencyKey: household.currency, name: 'Home', numAdults: 1, numDependents: 0, tenantKey: household.tenant }, { partial: true });
    const template = em.create(BudgetTemplateCategory, { amountBudgeted: 1000, budgetKey: budget, categoryKey: housing, month: 7, year: 2026 }, { partial: true });
    await em.flush();
    const spending = async () => {
      const rows = await getBudgetSpending({ accountKeys: [household.account.accountKey], period: 'monthly', templateKeys: [template.budgetTemplateCategoryKey], tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      return rows.find((row) => row.child_category_name === 'Mortgage')?.category_amount;
    };
    return { em, household, housing, spending };
  }

  it('adds a loan repayment\'s interest and fees to the other spending in its category', async () => {
    const { em, household, housing, spending } = await seedBudget();
    await addTransaction(em, household, { amount: -100, category: housing, date: JULY_15, status: 'BOOKED' });
    const repayment = await addTransaction(em, household, { amount: -500, category: housing, date: JULY_15, status: 'BOOKED' });
    const loan = em.create(Loan, { currencyKey: household.currency, name: 'House', openingBalanceDate: new Date('2026-01-01'), openingPrincipalBalance: 100_000, ownerAppuserKey: household.appuser, paymentFrequency: LoanPaymentFrequency.MONTHLY, rateType: LoanRateType.FIXED, status: LoanStatus.ACTIVE, tenantKey: household.tenant, type: LoanType.MORTGAGE }, { partial: true });
    em.create(LoanRepaymentLink, { allocationSource: LoanAllocationSource.MANUAL, feeAmount: 5, interestAmount: 25, linkedByAppuserKey: household.appuser, loanKey: loan, paymentDate: JULY_15, principalAmount: 470, tenantKey: household.tenant, totalPaymentAmount: 500, transactionKey: repayment }, { partial: true });
    await em.flush();

    // €100 of other spending plus €30 of interest and fees.
    await expect(spending()).resolves.toBe(130);
  });

  it('does not report a refund-only month as spending', async () => {
    const { em, household, housing, spending } = await seedBudget();
    await addTransaction(em, household, { amount: 40, category: housing, date: JULY_15, status: 'BOOKED' });

    await expect(spending()).resolves.toBe(0);
  });
});
