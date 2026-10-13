import { AppuserAccountType } from '@entity/Appuser';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { type Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';
import { subDays } from 'date-fns';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

import { Account } from '../entity/Account';
import { Currency } from '../entity/Currency';
import { Transaction } from '../entity/Transaction';
import {
  createSeedRandom,
  getSeedNow,
  getSeedToday,
  randomFloat,
  requireSeedDependency,
  seedUuid,
} from '../utils/seed';
import { demoTransactionPatterns as transactionTemplates } from './demo/demo-transactions';

const MAX_TRANSACTION_DAYS_INTERVAL = 120;
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

export class TransactionSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxTransactions: Transaction[] = [];
    const random = createSeedRandom('bank-transactions');
    const seedNow = getSeedNow();
    // Params
    const currency = requireSeedDependency(
      ctx['currencies'].find((c: Currency) => c.code === 'EUR'),
      'EUR currency',
    );
    const transactionStatus = requireSeedDependency(
      ctx['transactionStatuses'].find((t: TransactionStatus) => t.name === 'BOOKED'),
      'BOOKED transaction status',
    );

    const initialBalance = 1000;

    for (const user of USERS_TO_SEED) {
      let currentDate = getSeedToday();
      const appUser = requireSeedDependency(
        user.appUser === 'ADMIN' ? ctx['_ADMIN_appuser'] : ctx['_DEMO_appuser'],
        `${user.appUser} appuser`,
      );
      const tenant = requireSeedDependency(
        user.appUser === 'ADMIN' ? ctx['_ADMIN_tenant'] : ctx['_DEMO_tenant'],
        `${user.tenant} tenant`,
      );
      const seedAccount = requireSeedDependency(
        ctx['accounts'].find((a: Account) => {
          const matchesCurrency = a.currencyKey.currencyKey === currency.currencyKey;
          const matchesOwner = a.accountOwnerAppuserKey?.appuserKey === appUser.appuserKey;
          if (!matchesCurrency || !matchesOwner) {
            return false;
          }

          return user.appUser === 'DEMO'
            ? a.accountName === 'ActivoBank Current Account'
            : appUser.accountType === AppuserAccountType.ADMIN;
        }),
        `${user.appUser} EUR account`,
      );

      // Create all transactions first without balance
      const unsortedTransactions: Transaction[] = [];
      const totalTransactions = transactionTemplates.reduce((acc, template) => acc + template.count, 0);
      const daysInterval = Math.floor(MAX_TRANSACTION_DAYS_INTERVAL / totalTransactions);

      transactionTemplates.forEach((template) => {
        for (let i = 0; i < template.count; i++) {
          const transactionAmount = randomFloat(random, template.minValue, template.maxValue);
          const transactionDate = subDays(currentDate, daysInterval * i);
          const seedTransactionKey = `${user.appUser}-${template.description}-${i}-${transactionDate.toISOString()}`;

          const transaction = new Transaction();
          transaction.accountKey = seedAccount;
          transaction.tenantKey = tenant;
          transaction.appuserKey = appUser;
          const transactionType = requireSeedDependency(
            ctx['transactionTypes'].find((t: TransactionType) => t.name === template.type),
            `${template.type} transaction type`,
          );
          transaction.transactionTypeKey = transactionType;
          transaction.transactionDate = transactionDate;
          transaction.originalCurrencyKey = currency;
          transaction.originalAmount = transactionAmount;
          transaction.settlementCurrencyKey = currency;
          transaction.settlementAmount = transactionAmount;
          transaction.appuserCurrencyKey = currency;
          transaction.appuserSettlementAmount = transactionAmount;
          transaction.description = template.description;
          transaction.descriptionDirty = template.descriptionDirty;
          transaction.transactionStatusKey = transactionStatus;
          const merchant: TransactionMerchant = requireSeedDependency(
            ctx['transactionMerchants'].find(
              (m: TransactionMerchant) =>
                m.name === template.merchant &&
                m.tenantKey?.tenantKey === tenant.tenantKey &&
                m.normalizedName === normalizeMerchantName(template.merchant),
            ),
            `${template.merchant} transaction merchant`,
          );
          transaction.transactionMerchantKey = merchant;
          transaction.externalTransactionId = seedUuid('bank-transaction-external', seedTransactionKey);
          transaction.internalTransactionId = seedUuid('bank-transaction-internal', seedTransactionKey);
          transaction.reviewed = random() > 0.15;
          transaction.processed = true;
          transaction.createdAt = seedNow;
          transaction.updatedAt = seedNow;

          unsortedTransactions.push(transaction);
        }
        currentDate = subDays(currentDate, daysInterval * template.count);
      });

      // Sort transactions by date in descending order (newest first)
      const sortedTransactions = unsortedTransactions.toSorted(
        (a, b) => b.transactionDate!.getTime() - a.transactionDate!.getTime(),
      );

      // Calculate running balance for each transaction
      let runningBalance = initialBalance;
      for (let i = sortedTransactions.length - 1; i >= 0; i--) {
        const transaction = sortedTransactions[i];
        if (!transaction) {
          continue;
        }
        runningBalance += transaction.originalAmount!;
        transaction.balance = runningBalance;
        transaction.appuserCurrencyBalance = runningBalance;
      }

      seedAccount.balance = runningBalance;
      seedAccount.appuserCurrencyBalance = runningBalance;

      await em.persist([...sortedTransactions, seedAccount]).flush();
      ctxTransactions.push(...sortedTransactions);
    }

    ctx['transactions'] = ctxTransactions;
  }
}
