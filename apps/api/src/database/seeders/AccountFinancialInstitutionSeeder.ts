// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { AccountFinancialInstitution } from '@entity/AccountFinancialInstitution';
import { Seeder } from '@mikro-orm/seeder';

import seededFinancialInstitutions from './financial_institutions.json' with { type: 'json' };

/**
 * Entries of the seeded institution list (`financial_institutions.json`) that are left out because another entry is the same bank for
 * WonderMoney's purposes. `ACTIVOBANK_BSABESBB` ("Activo Bank") sits next to
 * `BANCOACTIVOBANK_ACTVPTPL` ("Banco ActivoBank"), and a user creating a manual account could
 * pick either.
 */
export const DUPLICATE_INSTITUTION_IDS: ReadonlySet<string> = new Set(['ACTIVOBANK_BSABESBB']);

export class AccountFinancialInstitutionSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const financialInstitutions = seededFinancialInstitutions as {
      bic: string;
      countries: string[];
      id: string;
      logo: string;
      name: string;
      transaction_total_days: string; // number
    }[];
    const ctxAccountFinancialInstitutions = [];
    for (const financialInstitution of financialInstitutions) {
      if (DUPLICATE_INSTITUTION_IDS.has(financialInstitution.id)) continue;
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
