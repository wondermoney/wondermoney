import type { Dictionary, EntityManager } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';

import { FinancialTransaction } from '@entity/FinancialTransaction';

import { AccountSeeder } from '../AccountSeeder';
import { BudgetSeeder } from '../BudgetSeeder';
import { demoBudget } from '../demo/demo-budget';
import { demoLoans } from '../demo/demo-loans';
import { demoAccounts } from '../demo/demo-fixtures';
import { demoPortfolios } from '../demo/demo-portfolio';
import { demoTransactionPatterns } from '../demo/demo-transactions';
import { FinancialTransactionSeeder } from '../FinancialTransactionSeeder';
import { PortfolioSeeder } from '../PortfolioSeeder';
import { TransactionSeeder } from '../TransactionSeeder';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';

function createEm() {
  const created: unknown[] = [];
  const em = {
    create: (_entity: unknown, data: unknown) => {
      created.push(data);
      return data;
    },
    flush: vi.fn().mockResolvedValue(undefined),
    persist: vi.fn().mockImplementation((entities: unknown[]) => {
      created.push(...entities);
      return em;
    }),
  } as unknown as EntityManager;
  return {
    created,
    em,
  };
}

describe('demo seeders', () => {
  it('seeds demo account names from fixtures', async () => {
    const { created, em } = createEm();
    const ctx: Dictionary = {
      _DEMO_appuser: { appuserKey: 1 },
      _DEMO_tenant: { tenantKey: 1 },
      accountFinancialInstitutions: [{ name: 'Banco ActivoBank' }, { name: 'Revolut' }],
      currencies: [
        { code: 'EUR', currencyKey: 1 },
        { code: 'USD', currencyKey: 2 },
      ],
    };

    await new AccountSeeder().run(em, ctx);

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountName: demoAccounts.current.accountName,
          accountNumber: demoAccounts.current.accountNumber,
          currencyKey: 1,
        }),
        expect.objectContaining({
          accountName: demoAccounts.usd.accountName,
          accountNumber: demoAccounts.usd.accountNumber,
        }),
        expect.objectContaining({
          accountName: demoAccounts.savings.accountName,
          accountNumber: demoAccounts.savings.accountNumber,
        }),
      ]),
    );
  });

  it('seeds demo budget name from fixtures', async () => {
    const { created, em } = createEm();
    const ctx: Dictionary = { _DEMO_appuser: { appuserKey: 1 }, currencies: [{ code: 'EUR', currencyKey: 1 }] };

    await new BudgetSeeder().run(em, ctx);

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: demoBudget.description,
          name: demoBudget.name,
          numAdults: demoBudget.numAdults,
          numDependents: demoBudget.numDependents,
        }),
      ]),
    );
  });

  it('seeds demo portfolio names from fixtures', async () => {
    const { created, em } = createEm();
    const ctx: Dictionary = {
      _DEMO_appuser: { appuserKey: 1 },
      _DEMO_tenant: { tenantKey: 1 },
      currencies: [
        { code: 'EUR', currencyKey: 1 },
        { code: 'USD', currencyKey: 2 },
      ],
    };

    await new PortfolioSeeder().run(em, ctx);

    for (const portfolio of demoPortfolios) {
      expect(created).toEqual(expect.arrayContaining([expect.objectContaining({ name: portfolio.name })]));
    }
  });

  it('keeps demo financial transactions on demo portfolios', async () => {
    const created: { data: Record<string, unknown>; entity: unknown }[] = [];
    const em = {
      create: (entity: unknown, data: Record<string, unknown>) => {
        created.push({ data, entity });
        return data;
      },
    } as unknown as EntityManager;
    const ctx: Dictionary = {
      _ADMIN_appuser: { appuserKey: 2 },
      _ADMIN_tenant: { tenantKey: 2 },
      _DEMO_appuser: { appuserKey: 1 },
      _DEMO_tenant: { tenantKey: 1, tenantType: 'demo' as const },
      currencies: [
        { code: 'EUR', currencyKey: 1 },
        { code: 'USD', currencyKey: 2 },
      ],
      financialAssets: [
        { financialAssetKey: 1, symbol: 'CURRENCY_EUR' },
        { financialAssetKey: 2, symbol: 'CURRENCY_USD' },
        { financialAssetKey: 3, symbol: 'AAPL' },
        { financialAssetKey: 4, symbol: 'GOOGL' },
        { financialAssetKey: 5, symbol: 'INTC' },
        { financialAssetKey: 6, symbol: 'NVDA' },
        { financialAssetKey: 7, symbol: 'CRM' },
        { financialAssetKey: 8, symbol: 'TXN' },
      ],
      financialBrokers: [{ financialBrokerKey: 1, name: 'degiro' }],
      financialTransactionTypes: [
        { financialTransactionTypeKey: 1, name: 'DEPOSIT' },
        { financialTransactionTypeKey: 2, name: 'BUY' },
        { financialTransactionTypeKey: 3, name: 'WITHDRAWAL' },
        { financialTransactionTypeKey: 4, name: 'SELL' },
        { financialTransactionTypeKey: 5, name: 'DIVIDEND' },
      ],
      portfolios: [],
    };

    await new PortfolioSeeder().run(em, ctx);
    ctx['portfolios'] = ctx['portfolios'].map((portfolio: { portfolioKey?: number }, index: number) => ({
      ...portfolio,
      portfolioKey: index + 1,
    }));
    await new FinancialTransactionSeeder().run(em, ctx);

    const demoAppuser = ctx['_DEMO_appuser'];
    const adminAppuser = ctx['_ADMIN_appuser'];
    const demoPortfolioKeys = new Set([
      ctx['portfolios'][0]?.portfolioKey,
      ctx['portfolios'][1]?.portfolioKey,
      ctx['portfolios'][2]?.portfolioKey,
    ]);
    const adminPortfolioKeys = new Set([
      ctx['portfolios'][3]?.portfolioKey,
      ctx['portfolios'][4]?.portfolioKey,
      ctx['portfolios'][5]?.portfolioKey,
    ]);
    const financialTransactions = created.filter(({ entity }) => entity === FinancialTransaction);

    expect(financialTransactions.length).toBeGreaterThan(0);
    const expectedTenantByAppuser = new Map([
      [adminAppuser, ctx['_ADMIN_tenant']],
      [demoAppuser, ctx['_DEMO_tenant']],
    ]);
    const expectedPortfolioKeysByAppuser = new Map([
      [adminAppuser, adminPortfolioKeys],
      [demoAppuser, demoPortfolioKeys],
    ]);

    for (const { data: transaction } of financialTransactions) {
      expect(transaction['portfolioKey']).toBeDefined();
      expect(transaction['financialAssetKey']).toBeDefined();
      const expectedTenant = expectedTenantByAppuser.get(transaction['appuserKey']);
      const expectedPortfolioKeys = expectedPortfolioKeysByAppuser.get(transaction['appuserKey']);
      expect(expectedTenant).toBeDefined();
      expect(expectedPortfolioKeys).toBeDefined();
      expect(transaction['tenantKey']).toBe(expectedTenant);
      expect(expectedPortfolioKeys?.has(transaction['portfolioKey'] as number)).toBe(true);
    }
  });

  it('exports loan fixture names', () => {
    expect(demoLoans).toMatchObject({ carLoan: { name: 'Family car loan' }, mortgage: { name: 'Home mortgage' } });
  });

  it('resolves the ADMIN transaction seed account by owner and currency', async () => {
    const { created, em } = createEm();
    const adminAppuser = { accountType: 'admin', appuserKey: 2 };
    const demoAppuser = { accountType: 'demo', appuserKey: 1 };
    const adminTenant = { tenantKey: 2 };
    const demoTenant = { tenantKey: 1 };
    const transactionMerchants = [...new Set(demoTransactionPatterns.map((pattern) => pattern.merchant))].flatMap((name) => [
      { name, tenantKey: adminTenant, normalizedName: normalizeMerchantName(name) },
      { name, tenantKey: demoTenant, normalizedName: normalizeMerchantName(name) },
    ]);
    const adminAccount = {
      accountKey: 20,
      accountName: 'Admin EUR Main',
      accountOwnerAppuserKey: adminAppuser,
      balance: 1000,
      currencyKey: { code: 'EUR', currencyKey: 1 },
      tenantKey: adminTenant,
    };
    const demoAccount = {
      accountKey: 10,
      accountName: demoAccounts.current.accountName,
      accountOwnerAppuserKey: demoAppuser,
      balance: 1000,
      currencyKey: { code: 'EUR', currencyKey: 1 },
      tenantKey: demoTenant,
    };
    const ctx: Dictionary = {
      _ADMIN_appuser: adminAppuser,
      _ADMIN_tenant: adminTenant,
      _DEMO_appuser: demoAppuser,
      _DEMO_tenant: demoTenant,
      accounts: [adminAccount, demoAccount],
      currencies: [{ code: 'EUR', currencyKey: 1 }],
      transactionMerchants,
      transactionStatuses: [{ name: 'BOOKED' }],
      transactionTypes: [...new Set(demoTransactionPatterns.map((pattern) => pattern.type))].map((name) => ({ name })),
    };

    await new TransactionSeeder().run(em as unknown as EntityManager, ctx);

    expect(created).toEqual(expect.arrayContaining([expect.objectContaining({ accountKey: adminAccount })]));
  });
});
