import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { AppuserMerchantCategory } from '@entity/AppuserMerchantCategory';
import { Source } from '@entity/AppuserMerchantCategory';
import { Category } from '@entity/Category';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { Seeder } from '@mikro-orm/seeder';

import { requireSeedDependency } from '../utils/seed';
import { transactionTemplates } from '../utils/transactions';

const USERS_TO_SEED = [
  {
    appUser: 'ADMIN',
    tenant: 'ADMIN',
  },
  {
    appUser: 'DEMO',
    tenant: 'DEMO',
  },
];

export class AppuserMerchantCategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const uniqueMerchants = new Set([...transactionTemplates.map((template) => template.merchant)]);
    const appuserMerchantCategories: AppuserMerchantCategory[] = [];
    const subCategories = requireSeedDependency(ctx['subCategories'] as Category[] | undefined, 'subCategories');
    const transactionMerchants = requireSeedDependency(
      ctx['transactionMerchants'] as TransactionMerchant[] | undefined,
      'transaction merchants',
    );

    for (const user of USERS_TO_SEED) {
      const appuser = requireSeedDependency(
        user.appUser === 'ADMIN' ? ctx['_ADMIN_appuser'] : ctx['_DEMO_appuser'],
        `${user.appUser} appuser`,
      );
      const tenant = requireSeedDependency(
        user.appUser === 'ADMIN' ? ctx['_ADMIN_tenant'] : ctx['_DEMO_tenant'],
        `${user.tenant} tenant`,
      );

      for (const merchantName of uniqueMerchants) {
        const randomTransactionForMerchant = requireSeedDependency(
          transactionTemplates.find((template) => template.merchant === merchantName),
          `transaction template for ${merchantName}`,
        );

        const appuserMerchantCategory = new AppuserMerchantCategory();
        appuserMerchantCategory.appuserKey = appuser;

        const category: Category = requireSeedDependency(
          subCategories.find((category: Category) => category.name === randomTransactionForMerchant.category),
          `${randomTransactionForMerchant.category} category`,
        );
        // @ts-expect-error - idk
        appuserMerchantCategory.categoryKey = category.categoryKey;

        const merchant: TransactionMerchant = requireSeedDependency(
          transactionMerchants.find(
            (merchant) => merchant.name === randomTransactionForMerchant.merchant && merchant.tenantKey?.tenantKey === tenant.tenantKey,
          ),
          `${randomTransactionForMerchant.merchant} merchant`,
        );
        // @ts-expect-error - idk
        appuserMerchantCategory.transactionMerchantKey = merchant.transactionMerchantKey;

        appuserMerchantCategory.source = Source.USER;

        appuserMerchantCategories.push(appuserMerchantCategory);
      }
    }

    await em.persist(appuserMerchantCategories).flush();
  }
}
