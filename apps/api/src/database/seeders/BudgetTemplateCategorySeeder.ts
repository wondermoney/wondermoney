import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import { Seeder } from '@mikro-orm/seeder';
import { calculateAmountBudgeted } from '@utils/budget';

import { getSeedYear, requireSeedDependency } from '../utils/seed';

export class BudgetTemplateCategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const subCategories = requireSeedDependency(ctx['subCategories'] as Category[] | undefined, 'subCategories');
    const defaultBudgetCategories = subCategories.filter((c) => c.isDefaultBudgetCategory);
    requireSeedDependency(defaultBudgetCategories[0], 'default budget category');
    const budgets = requireSeedDependency(ctx['budgets'] as Budget[] | undefined, 'budgets');
    const budget = requireSeedDependency(budgets[0], 'seeded budget');
    const demoAppuser = requireSeedDependency(ctx['_DEMO_appuser'], 'DEMO appuser');
    const budgetTemplateIncomes = requireSeedDependency(
      ctx['budgetTemplateIncomes'] as BudgetTemplateIncome[] | undefined,
      'budget template incomes',
    );
    const totalHouseholdAnnualizedMonthlyIncome = budgetTemplateIncomes.reduce(
      (acc, income) => acc + income.amount / 12,
      0,
    );
    const accounts = requireSeedDependency(ctx['accounts'] as Account[] | undefined, 'accounts');
    const demoAccounts = accounts.filter(
      (account) => account.accountOwnerAppuserKey?.appuserKey === demoAppuser.appuserKey,
    );
    requireSeedDependency(demoAccounts[0], 'DEMO budget account');
    const seedYear = getSeedYear();

    for (const month of Array(12).keys()) {
      defaultBudgetCategories.forEach((category) => {
        // @ts-expect-error - missing PK
        em.create(BudgetTemplateCategory, {
          accounts: demoAccounts,
          amountBudgeted: calculateAmountBudgeted({
            category,
            numAdults: budget.numAdults,
            numDependents: budget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: totalHouseholdAnnualizedMonthlyIncome,
          }),
          budgetKey: budget,
          categoryKey: category,
          month: month + 1,
          recurrency: category.recurrency,
          year: seedYear,
        });
      });
    }
  }
}
