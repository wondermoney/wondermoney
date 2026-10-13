// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';
import { addYears } from 'date-fns';

import { Account } from '@entity/Account';

import { demoAccounts } from './demo/demo-fixtures';
import { getSeedNow } from '../utils/seed';

export class AccountSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const seedNow = getSeedNow();
    const ctxAccounts = [];
    ctxAccounts.push(
      em.create(Account, {
        accountFinancialInstitutionKey: ctx.accountFinancialInstitutions.find((a) => a.name === 'Banco ActivoBank'),
        accountId: demoAccounts.current.accountId,
        accountName: demoAccounts.current.accountName,
        accountNumber: demoAccounts.current.accountNumber,
        accountOwnerAppuserKey: ctx._DEMO_appuser,
        appuserCurrencyBalance: demoAccounts.current.balance,
        balance: demoAccounts.current.balance,
        currencyKey: ctx.currencies.find((c) => c.code === demoAccounts.current.currency)?.currencyKey,
        holderName: demoAccounts.current.holderName,
        nordigenRequisitionKey: ctx.nordigenRequisitions[0],
        refreshedAt: addYears(seedNow, 20), // to avoid refreshing
        tenantKey: ctx._DEMO_tenant,
      }),
    );
    ctxAccounts.push(
      em.create(Account, {
        accountFinancialInstitutionKey: ctx.accountFinancialInstitutions.find((a) => a.name === 'Revolut'),
        accountId: demoAccounts.usd.accountId,
        accountName: demoAccounts.usd.accountName,
        accountNumber: demoAccounts.usd.accountNumber,
        accountOwnerAppuserKey: ctx._DEMO_appuser,
        appuserCurrencyBalance: demoAccounts.usd.balance * 0.94, // 1 USD = 0.94 EUR
        balance: demoAccounts.usd.balance,
        currencyKey: ctx.currencies.find((c) => c.code === demoAccounts.usd.currency)?.currencyKey,
        holderName: demoAccounts.usd.holderName,
        nordigenRequisitionKey: ctx.nordigenRequisitions[0],
        refreshedAt: addYears(seedNow, 20), // to avoid refreshing
        tenantKey: ctx._DEMO_tenant,
      }),
    );
    ctxAccounts.push(
      em.create(Account, {
        accountFinancialInstitutionKey: ctx.accountFinancialInstitutions.find((a) => a.name === 'Banco ActivoBank'),
        accountId: demoAccounts.savings.accountId,
        accountName: demoAccounts.savings.accountName,
        accountNumber: demoAccounts.savings.accountNumber,
        accountOwnerAppuserKey: ctx._DEMO_appuser,
        appuserCurrencyBalance: demoAccounts.savings.balance,
        balance: demoAccounts.savings.balance,
        currencyKey: ctx.currencies.find((c) => c.code === demoAccounts.savings.currency)?.currencyKey,
        holderName: demoAccounts.savings.holderName,
        nordigenRequisitionKey: ctx.nordigenRequisitions[0],
        refreshedAt: addYears(seedNow, 20),
        tenantKey: ctx._DEMO_tenant,
      }),
    );
    ctxAccounts.push(
      em.create(Account, {
        accountFinancialInstitutionKey: ctx.accountFinancialInstitutions.find((a) => a.name === 'Revolut'),
        accountId: '24603cf1-426f-47f0-af1e-b3b56629aaab-ADMIN',
        accountName: 'AB Bank Acc EUR',
        accountNumber: 'LT423250050435825597',
        accountOwnerAppuserKey: ctx._ADMIN_appuser,
        appuserCurrencyBalance: 1832.97,
        balance: 1832.97,
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        holderName: 'Admin User',
        nordigenRequisitionKey: ctx.nordigenRequisitions[1],
        refreshedAt: addYears(seedNow, 20), // to avoid refreshing
        tenantKey: ctx._ADMIN_tenant,
      }),
    );
    ctxAccounts.push(
      em.create(Account, {
        accountFinancialInstitutionKey: ctx.accountFinancialInstitutions.find((a) => a.name === 'Revolut'),
        accountId: 'a10de53f-0133-4637-ab2b-e6bbb759d235-ADMIN',
        accountName: 'Intl Acc USD',
        accountNumber: 'LT423250050435825597',
        accountOwnerAppuserKey: ctx._ADMIN_appuser,
        appuserCurrencyBalance: 835.42 * 0.94, // 1 USD = 0.94 EUR
        balance: 835.42,
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        holderName: 'Admin User',
        nordigenRequisitionKey: ctx.nordigenRequisitions[1],
        refreshedAt: addYears(seedNow, 20), // to avoid refreshing
        tenantKey: ctx._ADMIN_tenant,
      }),
    );
    ctx.accounts = ctxAccounts;
  }
}
