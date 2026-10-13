import type { Dictionary, EntityManager } from '@mikro-orm/core';
import type { Transaction } from '@entity/Transaction';

import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Category } from '@entity/Category';
import { Seeder } from '@mikro-orm/seeder';

import { requireSeedDependency } from '../utils/seed';
import { transactionTemplates } from '../utils/transactions';

export class AppuserTransactionCategorySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const appuserTransactionCategories: AppuserTransactionCategory[] = [];
    const transactions = requireSeedDependency(ctx['transactions'] as Transaction[] | undefined, 'transactions');
    const subCategories = requireSeedDependency(ctx['subCategories'] as Category[] | undefined, 'subCategories');

    for (const transaction of transactions) {
      const transactionTemplate = requireSeedDependency(
        transactionTemplates.find((template) => template.description === transaction.description),
        `transaction template for ${transaction.description}`,
      );

      const appuserTransactionCategory = new AppuserTransactionCategory();
      // @ts-expect-error - idk
      appuserTransactionCategory.appuserKey = transaction.appuserKey.appuserKey;

      const category: Category = requireSeedDependency(
        subCategories.find((category: Category) => category.name === transactionTemplate.category),
        `${transactionTemplate.category} category`,
      );
      // @ts-expect-error - idk
      appuserTransactionCategory.categoryKey = category.categoryKey;
      // @ts-expect-error - idk
      appuserTransactionCategory.transactionKey = transaction.transactionKey;
      appuserTransactionCategory.source = Source.USER;
      appuserTransactionCategories.push(appuserTransactionCategory);
    }

    await em.persist(appuserTransactionCategories).flush();
  }
}
