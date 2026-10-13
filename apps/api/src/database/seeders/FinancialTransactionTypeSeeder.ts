// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Seeder } from '@mikro-orm/seeder';

export class FinancialTransactionTypeSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const financialTransactionTypeEntities = [];
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'BUY' }));
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'SELL' }));
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'DIVIDEND' }));
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'DEPOSIT' }));
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'WITHDRAWAL' }));
    financialTransactionTypeEntities.push(em.create(FinancialTransactionType, { name: 'OFFER' }));
    ctx.financialTransactionTypes = financialTransactionTypeEntities;
  }
}
