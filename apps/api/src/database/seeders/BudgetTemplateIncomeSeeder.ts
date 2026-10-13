import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Seeder } from '@mikro-orm/seeder';
import { Recurrency } from '@utils/budget';

export class BudgetTemplateIncomeSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const budgetTemplateIncomes = [];
    budgetTemplateIncomes.push(
      // @ts-expect-error - missing PK
      em.create(BudgetTemplateIncome, {
        amount: 2000,
        budgetKey: ctx['budgets'][0].budgetKey,
        name: 'Salary from ACME',
        recurrency: Recurrency.MONTHLY_14,
      }),
    );
    budgetTemplateIncomes.push(
      // @ts-expect-error - missing PK
      em.create(BudgetTemplateIncome, {
        amount: 800,
        budgetKey: ctx['budgets'][0].budgetKey,
        name: 'Freelance Gig',
        recurrency: Recurrency.MONTHLY,
      }),
    );
    ctx['budgetTemplateIncomes'] = budgetTemplateIncomes;
  }
}
