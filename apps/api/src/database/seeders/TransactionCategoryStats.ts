import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { Category } from '@entity/Category';
import { TransactionCategoryStats } from '@entity/TransactionCategoryStats';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { Seeder } from '@mikro-orm/seeder';
import { Source } from '@entity/TransactionCategoryStats';

import { requireSeedDependency } from '../utils/seed';
import { transactionTemplates } from '../utils/transactions';

export class TransactionCategoryStatsSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const transactionCategoryStatsList: TransactionCategoryStats[] = [];
    const subCategories = requireSeedDependency(ctx['subCategories'] as Category[] | undefined, 'subCategories');
    const transactionMerchants = requireSeedDependency(
      ctx['transactionMerchants'] as TransactionMerchant[] | undefined,
      'transaction merchants',
    );

    const tenantOwnedMerchants = transactionMerchants.filter((merchant) => merchant.tenantKey != null);
    for (const merchant of tenantOwnedMerchants) {
      const merchantName = merchant.name;
      const randomTransactionForMerchant = requireSeedDependency(
        transactionTemplates.find((template) => template.merchant === merchantName),
        `transaction template for ${merchantName}`,
      );

      const transactionCategoryStats = new TransactionCategoryStats();
      const category: Category = requireSeedDependency(
        subCategories.find((category) => category.name === randomTransactionForMerchant.category),
        `${randomTransactionForMerchant.category} category`,
      );
      // @ts-expect-error - idk
      transactionCategoryStats.categoryKey = category.categoryKey;
      // @ts-expect-error - idk
      transactionCategoryStats.transactionMerchantKey = merchant.transactionMerchantKey;

      transactionCategoryStats.source = Source.USER;

      transactionCategoryStats.count = randomTransactionForMerchant.count;

      transactionCategoryStatsList.push(transactionCategoryStats);
    }

    await em.persist(transactionCategoryStatsList).flush();
  }
}
