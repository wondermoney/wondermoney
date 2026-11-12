import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/app', async () => ({ DI: (await import('@app/database/di')).DI }));

import { addBudget, budgetRows } from '@app/__tests__/__helpers__/budget-fixtures';
import { addCategory, addTransaction, seedHousehold } from '@app/__tests__/__helpers__/finance-fixtures';
import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';
import { CreditCardDetail } from '@entity/CreditCardDetail';
import { createInstallmentPlan, linkPostedInstallments } from '@service/installment/installment-plan.service';
import { toNumber } from '@utils/money';

import { getBudgetRowSpending, getBudgetSpending } from '../spending';

/*
 * A card purchase in installments counts in a budget one posted installment at a time, each in the
 * month its statement charges it, never the whole purchase in the month it was made. Installments
 * still to come are projections: no budget counts them until the bank posts them.
 */
describe('budget spending with installment purchases', () => {
  const db = useTestDatabase();

  async function seed() {
    const em = db.em();
    const household = await seedHousehold(em);
    em.create(CreditCardDetail, { accountKey: household.account, paymentDueDay: 10, statementCloseDay: 31, tenantKey: household.tenant }, { partial: true });
    const shopping = await addCategory(em, household, 'Electronics', await addCategory(em, household, 'Shopping'));
    const { budget } = await addBudget(em, household, { lines: [{ amount: 1000, category: shopping, months: [1, 2, 3], year: 2026 }] });
    const rows = await budgetRows(em, budget.budgetKey);
    await createInstallmentPlan(em, {
      accountKey: household.account.accountKey,
      description: 'Laptop store',
      installmentCount: 3,
      purchaseDate: new Date('2026-01-10T00:00:00.000Z'),
      totalAmount: 300,
    }, { tenant: household.tenant, tenantKey: household.tenant.tenantKey, user: household.appuser });

    const monthly = async (month: number) => {
      const key = rows.find((row) => row.month === month)?.budgetTemplateCategoryKey;
      const { categories } = await getBudgetSpending({ accountKeys: [household.account.accountKey], currency: household.currency, period: 'monthly', periodStartDay: 1, templateKeys: key ? [key] : [], tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      return toNumber(categories.find((category) => category.child_category_name === 'Electronics')?.category_amount);
    };
    const byRow = async () => {
      const spending = await getBudgetRowSpending({ accountKeys: [household.account.accountKey], currency: household.currency, periodStartDay: 1, templateKeys: rows.map((row) => row.budgetTemplateCategoryKey), tenantKey: household.tenant.tenantKey, viewerAppuserKey: household.appuser.appuserKey });
      return rows.map((row) => spending.get(row.budgetTemplateCategoryKey)?.spent);
    };
    return { byRow, em, household, monthly, shopping };
  }

  it('counts each posted installment in its own statement’s month, even when the bank dates them all on the purchase day', async () => {
    const { byRow, em, household, monthly, shopping } = await seed();
    // This bank books every installment with the original purchase date.
    for (const number of [1, 2]) {
      const row = await addTransaction(em, household, { amount: -100, category: shopping, date: new Date('2026-01-10T12:00:00.000Z'), status: 'BOOKED' });
      row.description = `LAPTOP STORE PARC ${number}/3`;
    }
    await em.flush();
    await linkPostedInstallments(em, { tenantKey: household.tenant.tenantKey });

    expect([await monthly(1), await monthly(2), await monthly(3)]).toEqual([100, 100, 0]);
    expect(await byRow()).toEqual([100, 100, 0]);
  });

  it('counts nothing for installments the bank has not posted yet', async () => {
    const { monthly } = await seed();

    expect([await monthly(1), await monthly(2), await monthly(3)]).toEqual([0, 0, 0]);
  });
});
