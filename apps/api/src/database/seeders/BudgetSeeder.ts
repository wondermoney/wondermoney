// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Budget } from '@entity/Budget';
import { Seeder } from '@mikro-orm/seeder';

import { demoBudget } from './demo/demo-budget';

export class BudgetSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const budgets = [];
    budgets.push(
      em.create(Budget, {
        appuserKey: ctx['_DEMO_appuser'].appuserKey,
        tenantKey: ctx['_DEMO_tenant'],
        currencyKey: ctx['currencies'].find((c) => c.code === 'EUR')?.currencyKey,
        description: demoBudget.description,
        name: demoBudget.name,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
      }),
    );
    ctx['budgets'] = budgets;
  }
}
