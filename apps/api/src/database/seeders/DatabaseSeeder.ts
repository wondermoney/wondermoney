import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { AccountSeeder } from './AccountSeeder';
import { AppuserMerchantCategorySeeder } from './AppuserMerchantCategorySeeder';
import { AppuserSeeder } from './AppuserSeeder';
import { AppuserTenantSeeder } from './AppuserTenantSeeder';
import { AppuserTransactionCategorySeeder } from './AppuserTransactionCategorySeeder';
import { BudgetSeeder } from './BudgetSeeder';
import { BudgetTemplateCategorySeeder } from './BudgetTemplateCategorySeeder';
import { BudgetTemplateIncomeSeeder } from './BudgetTemplateIncomeSeeder';
import { DemoCategorySeeder } from './DemoCategorySeeder';
import { FinancialAssetPriceSeeder } from './FinancialAssetPriceSeeder';
import { FinancialTransactionSeeder } from './FinancialTransactionSeeder';
import { LoanSeeder } from './LoanSeeder';
import { PortfolioSeeder } from './PortfolioSeeder';
import { PortfolioSnapshotSeeder } from './PortfolioSnapshotSeeder';
import { hasReferenceData, loadReferenceDataContext, ReferenceDataSeeder } from './ReferenceDataSeeder';
import { TenantSeeder } from './TenantSeeder';
import { TransactionCategoryStatsSeeder } from './TransactionCategoryStats';
import { TransactionMerchantSeeder } from './TransactionMerchantSeeder';
import { TransactionSeeder } from './TransactionSeeder';

/**
 * The local development data set: the reference data, then the admin, demo and empty users with
 * the demo household's accounts, transactions, portfolios, loans and budget.
 *
 * `migrate.ts` loads the reference data into an empty database, so after `pnpm migrate:dev` it is
 * usually there already: it is then read into the context instead of inserted again (which would
 * violate `currency_code_unique`). On a database without it (`SEED_REFERENCE_DATA=false`, or
 * `migration:fresh --seed`) it is seeded here.
 */
export class DatabaseSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary = {}): Promise<void> {
    if (await hasReferenceData(em)) await loadReferenceDataContext(em.fork(), ctx);
    else await this.call(em, [ReferenceDataSeeder], ctx);

    await this.call(em, [
      AppuserSeeder,
      TenantSeeder,
      AppuserTenantSeeder,
      DemoCategorySeeder,
      AccountSeeder,
      FinancialAssetPriceSeeder,
      PortfolioSeeder,
      FinancialTransactionSeeder,
      PortfolioSnapshotSeeder,
      TransactionMerchantSeeder,
      TransactionSeeder,
      LoanSeeder,
      AppuserTransactionCategorySeeder,
      AppuserMerchantCategorySeeder,
      TransactionCategoryStatsSeeder,
      BudgetSeeder,
      BudgetTemplateIncomeSeeder,
      BudgetTemplateCategorySeeder,
    ], ctx);
  }
}
