// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { Seeder } from '@mikro-orm/seeder';

import nordigenFinancialInstitutions from './nordigen_banks.json' with { type: 'json' };

export class AccountFinancialInstitutionSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const financialInstitutions = nordigenFinancialInstitutions as {
      bic: string;
      countries: string[];
      id: string;
      logo: string;
      name: string;
      transaction_total_days: string; // number
    }[];
    const ctxAccountFinancialInstitutions = [];
    for (const financialInstitution of financialInstitutions) {
      ctxAccountFinancialInstitutions.push(
        em.create(AccountFinancialInstitution, {
          displayName: financialInstitution.name,
          id: financialInstitution.id,
          logoUrl: financialInstitution.logo,
          name: financialInstitution.name,
        }),
      );
    }
    ctx.accountFinancialInstitutions = ctxAccountFinancialInstitutions;
  }
}
