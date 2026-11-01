/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('@service/portfolio/portfolio-snapshot.service', () => ({
  default: { backfillSnapshotsForPortfolio: vi.fn() },
}));

import { demoBudget } from '@app/database/seeders/demo/demo-budget';
import { demoAccounts } from '@app/database/seeders/demo/demo-fixtures';
import { Account } from '@entity/Account';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Transaction } from '@entity/Transaction';
import { DemoDataRefreshService } from '@service/demo-data/demo-data-refresh.service';
import portfolioSnapshotService from '@service/portfolio/portfolio-snapshot.service';
import { calculateAmountBudgeted, Recurrency } from '@utils/budget';

describe('demo data refresh service', () => {
  const demoAppuser = { appuserKey: 101, currencyKey: { code: 'EUR' } };
  const demoTenant = { tenantKey: 202 };
  const foundIdentity = {
    appuser: demoAppuser,
    appuserTenant: { appuserTenantKey: 3030 },
    status: 'found' as const,
    tenant: demoTenant,
  };
  const bookedStatus = { name: 'BOOKED', transactionStatusKey: 303 };
  const snapshotServiceMock = portfolioSnapshotService as unknown as {
    backfillSnapshotsForPortfolio: ReturnType<typeof vi.fn>;
  };
  const demoBudgetAccounts = [demoAccounts.current, demoAccounts.savings, demoAccounts.usd].map((account, index) => ({
    accountKey: index + 1,
    accountName: account.accountName,
    accountOwnerAppuserKey: demoAppuser,
    tenantKey: demoTenant,
  }));
  const demoCategories = demoBudget.requiredCategories.map((name, index) => ({
    categoryKey: index + 1,
    defaultHouseholdAmount: index === 0 ? 12 : 0,
    defaultHouseholdMultiplier: index === 0 ? 0.1 : 0,
    defaultIndividualAdultAmount: 0,
    defaultIndividualAdultMultiplier: 0,
    defaultIndividualAmount: 0,
    defaultIndividualDependentAmount: 0,
    defaultIndividualDependentMultiplier: 0,
    defaultIndividualMultiplier: 0,
    isDefaultBudgetCategory: true,
    isSystemCategory: true,
    name,
    recurrency: Recurrency.MONTHLY,
  }));
  const firstDemoCategory = demoCategories.at(0);

  if (!firstDemoCategory) throw new Error('Expected demo categories to exist');

  function findDemoCategories(where: any) {
    const matches = demoCategories.filter((category: any) => {
      if (where?.name && category.name !== where.name) return false;
      if (where?.deletedAt === null && category.deletedAt != null) return false;
      if (where?.isDefaultBudgetCategory === true && !category.isDefaultBudgetCategory) return false;
      if (where?.isSystemCategory === true && !category.isSystemCategory) return false;
      return true;
    });
    return where?.name ? matches.slice(0, 1) : matches;
  }

  function createEm() {
    const em: any = {
      assign: vi.fn(),
      count: vi.fn(async () => 0),
      create: vi.fn(),
      find: vi.fn(async (entity: unknown, where?: any) => (entity === Category ? findDemoCategories(where) : [])),
      findOne: vi.fn(),
      flush: vi.fn(),
      persist: vi.fn().mockReturnThis(),
      transactional: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(em)),
    };
    return em;
  }

  beforeEach(() => {
    snapshotServiceMock.backfillSnapshotsForPortfolio.mockReset();
  });

  it('skips refresh and warns when the demo identity is missing', async () => {
    const em = createEm();
    const logger = { warn: vi.fn() };
    const buildPlan = vi.fn();
    const resolveIdentity = vi.fn().mockResolvedValue({
      reason: 'missing-demo-appuser',
      status: 'missing' as const,
    });

    const service = createService(em, resolveIdentity, false, { buildPlan, logger });

    await expect(service.refresh()).resolves.toEqual({
      budgetUpdated: false,
      budgetVerified: false,
      dryRun: false,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
      skipped: true,
      skipReason: 'missing-demo-appuser',
    });
    expect(buildPlan).not.toHaveBeenCalled();
    expect(em.transactional).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { reason: 'missing-demo-appuser' },
      'Skipping demo data refresh because demo identity is missing',
    );
  });

  it('accepts existing budget template category amounts rounded to numeric(18,4)', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [],
    });
    const budget = {
      budgetKey: 1,
      currencyKey: { code: 'EUR' },
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    const expectedAmount = calculateAmountBudgeted({
      category: firstDemoCategory as Category,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
      totalHouseholdAnualizedMonthlyIncome: 2000,
    });
    const existingRow = {
      accounts: { getItems: () => demoBudgetAccounts, set: vi.fn() },
      amountBudgeted: expectedAmount + 0.00004,
      budgetKey: budget,
      categoryKey: firstDemoCategory,
      month: 6,
      recurrency: firstDemoCategory.recurrency,
      year: 2026,
    };

    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [budget];
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === BudgetTemplateCategory && where?.categoryKey === firstDemoCategory) return existingRow;
      if (entity === Budget && where?.name === demoBudget.name) return budget;
      if (where?.name === 'BOOKED') return bookedStatus;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await expect(service.refresh()).resolves.toMatchObject({ budgetVerified: true });
    expect(em.assign).not.toHaveBeenCalledWith(existingRow, expect.anything());
    expect((existingRow.accounts as { set: ReturnType<typeof vi.fn> }).set).not.toHaveBeenCalled();
  });

  function createService(
    em: ReturnType<typeof createEm>,
    resolveIdentity: (...args: any[]) => Promise<any>,
    useRealVerifier = false,
    overrides: Partial<ConstructorParameters<typeof DemoDataRefreshService>[0]> = {},
  ) {
    return new DemoDataRefreshService({
      em,
      resolveIdentity,
      ...(useRealVerifier ? {} : { verifyInvariants: vi.fn(async () => undefined) }),
      ...overrides,
    });
  }

  it('creates generated transactions and recomputes balances', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.current.accountName,
          amount: 10,
          description: 'Older',
          descriptionDirty: 'older dirty',
          externalTransactionId: 'DEMO-BANK-TXN-2',
          merchant: 'Merchant 2',
          offsetDays: 2,
          transactionDate: new Date('2026-06-01T00:00:00.000Z'),
          type: 'PAYMENT',
        },
        {
          accountName: demoAccounts.current.accountName,
          amount: 20,
          description: 'Newer',
          descriptionDirty: 'newer dirty',
          externalTransactionId: 'DEMO-BANK-TXN-1',
          merchant: 'Merchant 1',
          offsetDays: 1,
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'TRANSFER_IN',
        },
      ],
      portfolioTransactions: [],
    });
    const account = {
      accountKey: 404,
      accountName: demoAccounts.current.accountName,
      accountOwnerAppuserKey: demoAppuser,
      appuserCurrencyBalance: 100,
      appuserCurrencyKey: { code: 'EUR' },
      balance: 100,
      currencyKey: { code: 'EUR' },
      tenantKey: demoTenant,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [];
      if (entity === Account) return [account];
      if (entity === Transaction) return [];
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (_entity === Transaction && !where?.externalTransactionId)
        return { transactionDate: new Date('2026-06-05T00:00:00.000Z') };
      if (_entity === Budget && where?.name === demoBudget.name) return { budgetKey: 1, name: demoBudget.name };
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === 'PAYMENT') return { name: 'PAYMENT', transactionTypeKey: 1 };
      if (where?.name === 'TRANSFER_IN') return { name: 'TRANSFER_IN', transactionTypeKey: 2 };
      if (where?.name === 'Merchant 2') return { name: 'Merchant 2', transactionMerchantKey: 1 };
      if (where?.name === 'Merchant 1') return { name: 'Merchant 1', transactionMerchantKey: 2 };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown) => {
      if (entity === Transaction) return 25;
      return 0;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: true,
      dryRun: false,
      planned: { bankTransactions: 2, portfolioTransactions: 0 },
    });
    expect(
      calculateAmountBudgeted({
        category: demoCategories[0] as Category,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
        totalHouseholdAnualizedMonthlyIncome: 2000,
      }),
    ).toBeGreaterThan((demoCategories[0] as { defaultHouseholdAmount: number }).defaultHouseholdAmount);
    expect(
      em.create.mock.calls.filter((call: unknown[]) => call[0] === Transaction).map((call: unknown[]) => call[1]),
    ).toEqual([
      expect.objectContaining({
        appuserCurrencyKey: demoAppuser.currencyKey,
        appuserSettlementAmount: 10,
        externalTransactionId: 'DEMO-BANK-TXN-2',
      }),
      expect.objectContaining({
        appuserCurrencyKey: demoAppuser.currencyKey,
        appuserSettlementAmount: 20,
        externalTransactionId: 'DEMO-BANK-TXN-1',
      }),
    ]);
    expect(em.persist).toHaveBeenCalledTimes(8);
    expect(em.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ appuserCurrencyKey: demoAppuser.currencyKey, appuserSettlementAmount: 10 }),
    );
    expect(em.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ appuserCurrencyKey: demoAppuser.currencyKey, appuserSettlementAmount: 20 }),
    );
    expect(em.flush).toHaveBeenCalled();
  });

  it('upserts portfolio transactions and backfills snapshots', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 1.2,
          portfolioName: 'Long-term investments',
          quantity: 2,
          settlementAmount: 240,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    const portfolio = {
      currencyKey: { code: 'EUR' },
      portfolioKey: 77,
      portfolioOwnerAppuserKey: demoAppuser,
      tenantKey: demoTenant,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Portfolio) return [portfolio];
      if (entity === Budget) return [];
      if (entity === Category) return [{ ...firstDemoCategory, name: where?.name ?? firstDemoCategory.name }];
      if (entity === Transaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialAsset && where?.symbol === 'AAPL') return { financialAssetKey: 11, symbol: 'AAPL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await service.refresh();

    expect(em.create).toHaveBeenCalledWith(
      FinancialTransaction,
      expect.objectContaining({
        externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
        internalTransactionId: 'DEMO-PORTFOLIO-INTERNAL-DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
        portfolioKey: portfolio,
      }),
    );
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(
      portfolio.portfolioKey,
      new Date('2026-05-06T00:00:00.000Z'),
      new Date('2026-06-05T00:00:00.000Z'),
    );
  });

  it('updates an existing generated portfolio transaction instead of duplicating it', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 1.2,
          portfolioName: 'Long-term investments',
          quantity: 2,
          settlementAmount: 240,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    const portfolio = {
      currencyKey: { code: 'EUR' },
      portfolioKey: 77,
      portfolioOwnerAppuserKey: demoAppuser,
      tenantKey: demoTenant,
    };
    const existingTransaction = {
      externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
      transactionDate: new Date('2026-04-01T00:00:00.000Z'),
      transactionKey: 88,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Portfolio) return [portfolio];
      if (entity === Budget) return [];
      if (entity === Category) return [{ ...firstDemoCategory, name: where?.name ?? firstDemoCategory.name }];
      if (entity === FinancialTransaction) return [existingTransaction];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialAsset && where?.symbol === 'AAPL') return { financialAssetKey: 11, symbol: 'AAPL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      if (entity === FinancialTransaction && where?.externalTransactionId) return existingTransaction;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await service.refresh();

    expect(em.assign).toHaveBeenCalledWith(existingTransaction, expect.objectContaining({ portfolioKey: portfolio }));
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(
      portfolio.portfolioKey,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-06-05T00:00:00.000Z'),
    );
  });

  it('captures the previous portfolio transaction date before em.assign mutates the entity', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 1.2,
          portfolioName: 'Long-term investments',
          quantity: 2,
          settlementAmount: 240,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    const portfolio = {
      currencyKey: { code: 'EUR' },
      portfolioKey: 77,
      portfolioOwnerAppuserKey: demoAppuser,
      tenantKey: demoTenant,
    };
    const existingTransaction = {
      externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
      transactionDate: new Date('2026-04-01T00:00:00.000Z'),
      transactionKey: 88,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Portfolio) return [portfolio];
      if (entity === Budget) return [];
      if (entity === Category) return [{ ...firstDemoCategory, name: where?.name ?? firstDemoCategory.name }];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialAsset && where?.symbol === 'AAPL') return { financialAssetKey: 11, symbol: 'AAPL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      if (entity === FinancialTransaction && where?.externalTransactionId) return existingTransaction;
      return null;
    });
    em.assign.mockImplementation((entity: any, payload: any) => Object.assign(entity, payload));

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await service.refresh();

    expect(existingTransaction.transactionDate).toEqual(new Date('2026-05-12T00:00:00.000Z'));
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).toHaveBeenCalledWith(
      portfolio.portfolioKey,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-06-05T00:00:00.000Z'),
    );
  });

  it('sets portfolio transaction appuser conversion and fee currency payload', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-US-GROWTH-GOOGL-BUY-00',
          feeAmount: 2.3,
          portfolioName: 'US growth portfolio',
          quantity: 4,
          settlementAmount: 360,
          symbol: 'GOOGL',
          transactionDate: new Date('2026-06-03T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    const portfolio = {
      currencyKey: { code: 'USD', currencyKey: 2 },
      portfolioKey: 88,
      portfolioOwnerAppuserKey: { ...demoAppuser, currencyKey: { code: 'EUR', currencyKey: 1 } },
      tenantKey: demoTenant,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Portfolio) return [portfolio];
      if (entity === Budget) return [];
      if (entity === Category) return [{ ...firstDemoCategory, name: where?.name ?? firstDemoCategory.name }];
      if (entity === FinancialTransaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialAsset && where?.symbol === 'GOOGL') return { financialAssetKey: 11, symbol: 'GOOGL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      if (entity === ExchangeRate) return { rate: 1.1 };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await service.refresh();

    const createdPortfolioTransaction = em.create.mock.calls.find(
      (call: [unknown, unknown]) => call[0] === FinancialTransaction,
    )?.[1] as
      | undefined
      | {
          appuserCurrencyExchangeRate?: number;
          appuserSettlementAmount?: number;
          appuserUnitAmount?: number;
          feeCurrencyKey?: unknown;
        };

    expect(createdPortfolioTransaction).toMatchObject({ feeCurrencyKey: portfolio.currencyKey });
    expect(createdPortfolioTransaction?.appuserCurrencyExchangeRate).toBe(1.1);
    expect(createdPortfolioTransaction?.appuserSettlementAmount).toBeCloseTo(396);
    expect(createdPortfolioTransaction?.appuserUnitAmount).toBeCloseTo(99);
  });

  it('fails when no carry-forward exchange rate exists for portfolio conversion', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-US-GROWTH-GOOGL-BUY-00',
          feeAmount: 2.3,
          portfolioName: 'US growth portfolio',
          quantity: 4,
          settlementAmount: 360,
          symbol: 'GOOGL',
          transactionDate: new Date('2026-06-03T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    const portfolio = {
      currencyKey: { code: 'USD', currencyKey: 2 },
      portfolioKey: 88,
      portfolioOwnerAppuserKey: { ...demoAppuser, currencyKey: { code: 'EUR', currencyKey: 1 } },
      tenantKey: demoTenant,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Portfolio) return [portfolio];
      if (entity === Budget) return [];
      if (entity === Category) return [{ ...firstDemoCategory, name: where?.name ?? firstDemoCategory.name }];
      if (entity === FinancialTransaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialAsset && where?.symbol === 'GOOGL') return { financialAssetKey: 11, symbol: 'GOOGL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(/Missing exchange rate/);
  });

  it.each([
    ['portfolio', Portfolio, 'Expected exactly one demo portfolio for Long-term investments, found 0', null],
    ['type', FinancialTransactionType, 'FinancialTransactionType not found: BUY', { name: 'BUY' }],
    ['asset', FinancialAsset, 'FinancialAsset not found: AAPL', { symbol: 'AAPL' }],
    ['broker', FinancialBroker, 'FinancialBroker not found: degiro', { name: 'degiro' }],
  ])('fails closed when %s lookup is missing', async (_label, _entity, message, _where) => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 1.2,
          portfolioName: 'Long-term investments',
          quantity: 2,
          settlementAmount: 240,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    em.find.mockImplementation(async (entityName: unknown) => {
      if (entityName === Budget) return [];
      if (entityName === Category) return findDemoCategories({ name: demoBudget.requiredCategories[0] });
      if (entityName === Portfolio)
        return _label === 'portfolio'
          ? []
          : [
              {
                currencyKey: { code: 'EUR' },
                portfolioKey: 77,
                portfolioOwnerAppuserKey: demoAppuser,
                tenantKey: demoTenant,
              },
            ];
      return [];
    });
    em.findOne.mockImplementation(async (entityName: unknown, lookup: any) => {
      if (lookup?.name === 'BOOKED') return bookedStatus;
      if (entityName === FinancialTransactionType)
        return _label === 'type' ? null : { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entityName === FinancialAsset) return _label === 'asset' ? null : { financialAssetKey: 11, symbol: 'AAPL' };
      if (entityName === FinancialBroker)
        return _label === 'broker' ? null : { financialBrokerKey: 22, name: 'degiro' };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(message);
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('creates the demo budget shell when missing', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [],
    });

    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [];
      if (entity === Account) return [];
      if (entity === Transaction) return [];
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: true,
      dryRun: false,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
    });
    expect(em.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        appuserKey: demoAppuser,
        currencyKey: demoAppuser.currencyKey,
        description: demoBudget.description,
        name: demoBudget.name,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
      }),
    );
    expect(em.persist).toHaveBeenCalledTimes(demoCategories.length + 1);
  });

  it('updates the demo budget core fields when present', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [],
    });
    const existingBudget = {
      budgetKey: 1,
      description: 'stale',
      name: demoBudget.name,
      numAdults: 1,
      numDependents: 0,
    };

    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [existingBudget];
      if (entity === Account) return [];
      if (entity === Transaction) return [];
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return existingBudget;
      if (_entity === BudgetTemplateCategory) return null;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: true,
      dryRun: false,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
    });
    expect(em.assign).toHaveBeenCalledWith(
      existingBudget,
      expect.objectContaining({
        currencyKey: demoAppuser.currencyKey,
        description: demoBudget.description,
        name: demoBudget.name,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
      }),
    );
  });

  it('creates missing current-month budget categories without duplicating existing rows', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [],
    });
    const existingBudget = {
      budgetKey: 11,
      currencyKey: demoAppuser.currencyKey,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [existingBudget];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Transaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return existingBudget;
      if (_entity === BudgetTemplateCategory && where?.categoryKey?.categoryKey === demoCategories.at(0)?.categoryKey)
        return {
          accounts: { getItems: () => demoBudgetAccounts, set: vi.fn() },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[0] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          budgetTemplateCategoryKey: 1,
          recurrency: 'MONTHLY',
        };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).resolves.toMatchObject({ budgetUpdated: true, budgetVerified: true });
    expect(em.persist).toHaveBeenCalledTimes(demoCategories.length - 1);
    expect(em.findOne).toHaveBeenCalledWith(
      BudgetTemplateCategory,
      expect.objectContaining({ budgetKey: existingBudget, categoryKey: demoCategories.at(0), month: 6, year: 2026 }),
      expect.objectContaining({ populate: ['accounts'] }),
    );
    expect(em.create).toHaveBeenCalledWith(
      BudgetTemplateCategory,
      expect.objectContaining({ accounts: demoBudgetAccounts, categoryKey: demoCategories[1] }),
    );
  });

  it('is a no-op when the current-month budget already matches', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T12:34:56.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [],
    });
    const existingBudget = {
      budgetKey: 11,
      currencyKey: demoAppuser.currencyKey,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [existingBudget];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Transaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return existingBudget;
      if (_entity === BudgetTemplateCategory)
        return {
          accounts: { getItems: () => demoBudgetAccounts, set: vi.fn() },
          amountBudgeted: Number(
            calculateAmountBudgeted({
              category: demoCategories.find(
                (category) => category.categoryKey === where?.categoryKey?.categoryKey,
              ) as Category,
              numAdults: demoBudget.numAdults,
              numDependents: demoBudget.numDependents,
              totalHouseholdAnualizedMonthlyIncome: 2000,
            }).toFixed(4),
          ),
          budgetTemplateCategoryKey: 1,
          recurrency: 'MONTHLY',
        };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh({ asOfDate })).resolves.toEqual({
      budgetUpdated: false,
      budgetVerified: true,
      dryRun: false,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
    });
    expect(em.assign).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('repairs stale current-month budget categories', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T12:34:56.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [],
    });
    const existingBudget = {
      budgetKey: 11,
      currencyKey: demoAppuser.currencyKey,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    const staleCategory = {
      accounts: { getItems: () => [demoBudgetAccounts[0]], set: vi.fn() },
      amountBudgeted: 1,
      budgetTemplateCategoryKey: 1,
      categoryKey: demoCategories[0],
      recurrency: 'WEEKLY',
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [existingBudget];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Transaction) return [];
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return existingBudget;
      if (_entity === BudgetTemplateCategory && where?.categoryKey?.categoryKey === demoCategories.at(0)?.categoryKey) {
        return staleCategory;
      }
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh({ asOfDate })).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: true,
      dryRun: false,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
    });
    expect(em.assign).toHaveBeenCalledWith(
      staleCategory,
      expect.objectContaining({ amountBudgeted: expect.any(Number), recurrency: 'MONTHLY' }),
    );
    expect(staleCategory.accounts.set).toHaveBeenCalledWith(demoBudgetAccounts);
  });

  it('reports updates in dry-run mode without mutating state', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T12:34:56.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [],
    });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [];
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh({ asOfDate, dryRun: true })).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: false,
      dryRun: true,
      planned: { bankTransactions: 0, portfolioTransactions: 0 },
    });
    expect(em.assign).not.toHaveBeenCalled();
    expect(em.persist).not.toHaveBeenCalled();
  });

  it('fails closed when a required category is duplicated or deleted', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [],
      portfolioTransactions: [],
    });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [];
      if (entity === Category && where?.name === demoBudget.requiredCategories[0]) {
        return [
          { ...demoCategories[0], categoryKey: 1 },
          { ...demoCategories[0], categoryKey: 99, deletedAt: new Date() },
        ];
      }
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).rejects.toThrow(
      `Expected exactly one demo budget category for ${demoBudget.requiredCategories[0]}, found 2`,
    );
  });

  it('updates an existing generated transaction instead of duplicating it', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.current.accountName,
          amount: 10,
          description: 'Tx',
          descriptionDirty: 'tx dirty',
          externalTransactionId: 'DEMO-BANK-TXN-1',
          merchant: 'Merchant 1',
          offsetDays: 1,
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'PAYMENT',
        },
      ],
      portfolioTransactions: [],
    });
    const account = {
      accountKey: 404,
      accountName: demoAccounts.current.accountName,
      accountOwnerAppuserKey: demoAppuser,
      balance: 100,
      currencyKey: { code: 'EUR' },
      tenantKey: demoTenant,
    };
    const existingTransaction = { externalTransactionId: 'DEMO-BANK-TXN-1', transactionKey: 1 };
    const existingBudget = {
      budgetKey: 11,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [existingBudget];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return [account];
      if (entity === Transaction) return [existingTransaction];
      return [];
    });

    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return existingBudget;
      if (where?.externalTransactionId === 'DEMO-BANK-TXN-1') return existingTransaction;
      if (where?.name === 'PAYMENT') return { name: 'PAYMENT', transactionTypeKey: 1 };
      if (where?.name === 'Merchant 1') return { name: 'Merchant 1', transactionMerchantKey: 2 };
      return null;
    });
    const service = createService(em, resolveIdentity, false, { buildPlan });

    await service.refresh();

    expect(em.assign).toHaveBeenCalled();
  });

  it('keeps balances idempotent across repeated refreshes', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.current.accountName,
          amount: 10,
          description: 'Tx 1',
          descriptionDirty: 'tx 1 dirty',
          externalTransactionId: 'DEMO-BANK-TXN-1',
          merchant: 'Merchant 1',
          offsetDays: 1,
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'PAYMENT',
        },
      ],
      portfolioTransactions: [],
    });
    const account = {
      accountKey: 404,
      accountName: demoAccounts.current.accountName,
      accountOwnerAppuserKey: demoAppuser,
      appuserCurrencyBalance: 100,
      appuserCurrencyKey: { code: 'EUR' },
      balance: 100,
      currencyKey: { code: 'EUR' },
      tenantKey: demoTenant,
    };
    const existingTransaction = {
      appuserCurrencyBalance: 10,
      externalTransactionId: 'DEMO-BANK-TXN-1',
      settlementAmount: 10,
      transactionKey: 1,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Category) return findDemoCategories(where);
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return [account];
      if (entity === Transaction) return [existingTransaction];
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === 'PAYMENT') return { name: 'PAYMENT', transactionTypeKey: 1 };
      if (where?.name === 'Merchant 1') return { name: 'Merchant 1', transactionMerchantKey: 2 };
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await service.refresh();
    const firstBalance = account.balance;
    const firstAppuserBalance = account.appuserCurrencyBalance;

    await service.refresh();

    expect(account.balance).toBe(firstBalance);
    expect(account.appuserCurrencyBalance).toBe(firstAppuserBalance);
  });

  it('throws when the demo bank account lookup is ambiguous', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.current.accountName,
          amount: 10,
          description: 'Tx',
          descriptionDirty: 'tx dirty',
          externalTransactionId: 'DEMO-BANK-TXN-1',
          merchant: 'Merchant 1',
          offsetDays: 1,
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'PAYMENT',
        },
      ],
      portfolioTransactions: [],
    });

    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name)
        return {
          budgetKey: 11,
          description: demoBudget.description,
          name: demoBudget.name,
          numAdults: demoBudget.numAdults,
          numDependents: demoBudget.numDependents,
        };
      return null;
    });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget)
        return [
          {
            budgetKey: 11,
            description: demoBudget.description,
            name: demoBudget.name,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
          },
        ];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return [{ accountKey: 1 }, { accountKey: 2 }];
      return [];
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).rejects.toThrow(
      `Expected exactly one demo bank account for ${demoAccounts.current.accountName}, found 2`,
    );
  });

  it('fails closed before writes when a later merchant is missing', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.current.accountName,
          amount: 10,
          description: 'Older',
          descriptionDirty: 'older dirty',
          externalTransactionId: 'DEMO-BANK-TXN-2',
          merchant: 'Merchant 2',
          offsetDays: 2,
          transactionDate: new Date('2026-06-01T00:00:00.000Z'),
          type: 'PAYMENT',
        },
        {
          accountName: demoAccounts.current.accountName,
          amount: 20,
          description: 'Newer',
          descriptionDirty: 'newer dirty',
          externalTransactionId: 'DEMO-BANK-TXN-1',
          merchant: 'Missing merchant',
          offsetDays: 1,
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'TRANSFER_IN',
        },
      ],
      portfolioTransactions: [],
    });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget)
        return [
          {
            budgetKey: 11,
            description: demoBudget.description,
            name: demoBudget.name,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
          },
        ];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account)
        return [
          {
            accountKey: 404,
            accountName: demoAccounts.current.accountName,
            accountOwnerAppuserKey: demoAppuser,
            balance: 100,
            currencyKey: { code: 'EUR' },
            tenantKey: demoTenant,
          },
        ];
      if (entity === Transaction) return [];
      return [];
    });

    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name)
        return {
          budgetKey: 11,
          description: demoBudget.description,
          name: demoBudget.name,
          numAdults: demoBudget.numAdults,
          numDependents: demoBudget.numDependents,
        };
      if (where?.name === 'PAYMENT') return { name: 'PAYMENT', transactionTypeKey: 1 };
      if (where?.name === 'TRANSFER_IN') return { name: 'TRANSFER_IN', transactionTypeKey: 2 };
      if (where?.name === 'Merchant 2') return { name: 'Merchant 2', transactionMerchantKey: 1 };
      if (where?.name === 'Missing merchant') return null;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh()).resolves.toMatchObject({ budgetUpdated: true, budgetVerified: true });
    expect(em.flush).toHaveBeenCalled();
  });

  it('converts USD demo account amounts using the account appuser balance ratio', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [
        {
          accountName: demoAccounts.usd.accountName,
          amount: -45,
          description: 'USD card purchase',
          descriptionDirty: 'card purchase',
          externalTransactionId: 'DEMO-BANK-TXN-USD-1',
          merchant: 'PayPal Pedro',
          offsetDays: 30,
          transactionDate: new Date('2026-06-01T00:00:00.000Z'),
          type: 'PAYMENT',
        },
      ],
      portfolioTransactions: [],
    });
    const usdAccount = {
      accountKey: 405,
      accountName: demoAccounts.usd.accountName,
      accountOwnerAppuserKey: demoAppuser,
      appuserCurrencyBalance: 94,
      balance: 100,
      currencyKey: { code: 'USD' },
      tenantKey: demoTenant,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget)
        return [
          {
            budgetKey: 11,
            description: demoBudget.description,
            name: demoBudget.name,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
          },
        ];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return [usdAccount];
      if (entity === Transaction) return [];
      return [];
    });

    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === 'PAYMENT') return { name: 'PAYMENT', transactionTypeKey: 1 };
      if (where?.name === 'PayPal Pedro') return { name: 'PayPal Pedro', transactionMerchantKey: 1 };
      return null;
    });
    const service = createService(em, resolveIdentity, false, { buildPlan });

    await service.refresh();

    expect(em.persist).toHaveBeenCalled();
    expect(
      em.create.mock.calls.filter((call: unknown[]) => call[0] === Transaction).map((call: unknown[]) => call[1]),
    ).toEqual([
      expect.objectContaining({ appuserCurrencyKey: demoAppuser.currencyKey, appuserSettlementAmount: -42.3 }),
    ]);
  });

  it('still does not persist in dry-run mode', async () => {
    const asOfDate = new Date('2026-06-05T12:34:56.000Z');
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate: new Date('2026-06-05T00:00:00.000Z'),
      bankTransactions: [{ id: 'bank-1' }, { id: 'bank-2' }],
      portfolioTransactions: [{ id: 'portfolio-1' }],
    });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [];
      if (entity === Category) return findDemoCategories(where);
      return [];
    });
    em.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      return null;
    });

    const service = createService(em, resolveIdentity, false, { buildPlan });

    await expect(service.refresh({ asOfDate, dryRun: true })).resolves.toEqual({
      budgetUpdated: true,
      budgetVerified: false,
      dryRun: true,
      planned: { bankTransactions: 2, portfolioTransactions: 1 },
    });

    expect(em.create).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
    expect(snapshotServiceMock.backfillSnapshotsForPortfolio).not.toHaveBeenCalled();
  });

  it('passes post-refresh invariants on the success path', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 1.2,
          portfolioName: 'Long-term investments',
          quantity: 2,
          settlementAmount: 240,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-29T00:00:00.000Z'),
          type: 'BUY',
        },
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-DIVIDEND-00',
          feeAmount: 0,
          portfolioName: 'Long-term investments',
          quantity: 0,
          settlementAmount: 5,
          symbol: 'AAPL',
          transactionDate: new Date('2026-06-02T00:00:00.000Z'),
          type: 'DIVIDEND',
        },
      ],
    });
    const budget = {
      budgetKey: 11,
      currencyKey: demoAppuser.currencyKey,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
    };
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [budget];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      if (entity === Transaction) return [{ transactionDate: asOfDate }];
      if (entity === Portfolio)
        return [
          {
            currencyKey: { code: 'EUR' },
            name: 'Long-term investments',
            portfolioKey: 1,
            portfolioOwnerAppuserKey: demoAppuser,
            tenantKey: demoTenant,
          },
        ];
      if (entity === PortfolioSnapshot)
        return Array.from({ length: 30 }, (_, index) => ({ snapshotDate: new Date(Date.UTC(2026, 4, index + 1)) }));
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Budget && where?.name === demoBudget.name) return budget;
      if (entity === Transaction && where?.externalTransactionId?.$like)
        return { externalTransactionId: 'DEMO-BANK-TXN-OK', transactionDate: asOfDate };
      if (entity === Transaction) return { transactionDate: asOfDate };
      if (entity === PortfolioSnapshot) return { snapshotDate: asOfDate };
      if (entity === PortfolioSnapshot) return { snapshotDate: asOfDate };
      if (where?.name === 'BOOKED') return bookedStatus;
      if (entity === FinancialTransactionType && where?.name === 'BUY')
        return { financialTransactionTypeKey: 1, name: 'BUY' };
      if (entity === FinancialTransactionType && where?.name === 'DIVIDEND')
        return { financialTransactionTypeKey: 2, name: 'DIVIDEND' };
      if (entity === FinancialAsset && where?.symbol === 'AAPL') return { financialAssetKey: 11, symbol: 'AAPL' };
      if (entity === FinancialBroker && where?.name === 'degiro') return { financialBrokerKey: 22, name: 'degiro' };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown) => {
      if (entity === Transaction) return 25;
      if (entity === FinancialTransaction) return 1;
      if (entity === PortfolioSnapshot) return 8;
      return 0;
    });

    const service = createService(em, resolveIdentity, true, { buildPlan });
    await expect(service.refresh()).resolves.toMatchObject({ dryRun: false });
  });

  it('throws when recent demo bank transactions are missing', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    em.find.mockImplementation(async (entity: unknown, where: any) =>
      entity === Category
        ? findDemoCategories(where)
        : entity === Account
          ? demoBudgetAccounts
          : entity === Budget
            ? [{ budgetKey: 1, name: demoBudget.name }]
            : entity === BudgetTemplateCategory
              ? demoBudget.requiredCategories.map((_name, index) => ({
                  accounts: { getItems: () => demoBudgetAccounts },
                  amountBudgeted: calculateAmountBudgeted({
                    category: demoCategories[index] as Category,
                    numAdults: demoBudget.numAdults,
                    numDependents: demoBudget.numDependents,
                    totalHouseholdAnualizedMonthlyIncome: 2000,
                  }),
                  categoryKey: demoCategories[index],
                  recurrency: 'MONTHLY',
                }))
              : [],
    );
    em.findOne.mockImplementation(async (entity: unknown, where: any) =>
      entity === Transaction
        ? { transactionDate: asOfDate }
        : entity === FinancialAsset && where?.symbol === 'CURRENCY_EUR'
          ? { financialAssetKey: 7, symbol: 'CURRENCY_EUR' }
          : entity === FinancialTransactionType && where?.name === 'DEPOSIT'
            ? { financialTransactionTypeKey: 1, name: 'DEPOSIT' }
            : entity === FinancialBroker && where?.name === 'degiro'
              ? { financialBrokerKey: 22, name: 'degiro' }
              : where?.name === 'BOOKED'
                ? bookedStatus
                : where?.name === demoBudget.name
                  ? { budgetKey: 1, name: demoBudget.name }
                  : null,
    );
    em.count.mockImplementation(async (entity: unknown) => (entity === Transaction ? 1 : 0));
    const service = createService(em, resolveIdentity, true, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(/Expected at least 25 demo bank transactions/);
  });

  it('ignores unrelated fresh non-generated transactions in bank invariants', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account)
        return [
          {
            accountKey: 1,
            accountName: demoAccounts.current.accountName,
            accountOwnerAppuserKey: demoAppuser,
            balance: 100,
            currencyKey: { code: 'EUR' },
            tenantKey: demoTenant,
          },
        ];
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      if (entity === PortfolioSnapshot)
        return Array.from({ length: 30 }, (_, index) => ({ snapshotDate: new Date(Date.UTC(2026, 5, index + 1)) }));
      if (entity === PortfolioSnapshot) return [{ snapshotDate: asOfDate }];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Transaction && where?.externalTransactionId?.$like)
        return { externalTransactionId: 'DEMO-BANK-TXN-STALE', transactionDate: new Date('2026-05-01T00:00:00.000Z') };
      if (entity === Transaction) return { externalTransactionId: 'NON-GENERATED-RECENT', transactionDate: asOfDate };
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return { budgetKey: 1, name: demoBudget.name };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown) => {
      if (entity === Transaction) return 50;
      if (entity === FinancialTransaction) return 0;
      if (entity === PortfolioSnapshot) return 0;
      return 0;
    });

    const service = createService(em, resolveIdentity, true, { buildPlan });

    await expect(service.refresh()).rejects.toThrow(/Demo bank transactions are stale/);
  });

  it('ignores future generated bank transactions for freshness and count checks', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Transaction && where?.externalTransactionId?.$like) {
        const futureDate = new Date('2026-06-06T00:00:00.000Z');
        return where?.transactionDate?.$lte && futureDate > where.transactionDate.$lte
          ? null
          : { externalTransactionId: 'DEMO-BANK-TXN-FUTURE', transactionDate: futureDate };
      }
      if (entity === Transaction) return null;
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return { budgetKey: 1, name: demoBudget.name };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Transaction) return where?.transactionDate?.$lte ? 25 : 0;
      if (entity === FinancialTransaction) return 0;
      if (entity === PortfolioSnapshot) return 0;
      return 0;
    });

    const service = createService(em, resolveIdentity, true, { buildPlan });

    await expect(service.refresh()).rejects.toThrow(/Demo bank transactions are stale/);
  });

  it('includes the 30-day boundary in the generated bank threshold', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    em.find.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Transaction && where?.externalTransactionId?.$like)
        return { externalTransactionId: 'DEMO-BANK-TXN-30', transactionDate: asOfDate };
      if (entity === Transaction) return { transactionDate: asOfDate };
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name) return { budgetKey: 1, name: demoBudget.name };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown) => {
      if (entity === Transaction) return 25;
      if (entity === FinancialTransaction) return 0;
      if (entity === PortfolioSnapshot) return 0;
      return 0;
    });

    const service = createService(em, resolveIdentity, true, { buildPlan });

    await expect(service.refresh()).resolves.toMatchObject({ budgetVerified: true });
  });

  it('throws when current-month demo budget categories are missing', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    em.find.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === BudgetTemplateCategory)
        return [
          {
            accounts: { getItems: () => demoBudgetAccounts },
            amountBudgeted: calculateAmountBudgeted({
              category: demoCategories[0] as Category,
              numAdults: demoBudget.numAdults,
              numDependents: demoBudget.numDependents,
              totalHouseholdAnualizedMonthlyIncome: 2000,
            }),
            categoryKey: demoCategories[0],
            recurrency: 'MONTHLY',
          },
        ];
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) =>
      entity === BudgetTemplateCategory
        ? {
            accounts: { getItems: () => demoBudgetAccounts },
            amountBudgeted: calculateAmountBudgeted({
              category: demoCategories[0] as Category,
              numAdults: demoBudget.numAdults,
              numDependents: demoBudget.numDependents,
              totalHouseholdAnualizedMonthlyIncome: 2000,
            }),
            categoryKey: demoCategories[0],
            recurrency: 'MONTHLY',
          }
        : entity === Transaction
          ? { transactionDate: asOfDate }
          : entity === FinancialAsset && where?.symbol === 'CURRENCY_EUR'
            ? { financialAssetKey: 7, symbol: 'CURRENCY_EUR' }
            : entity === FinancialTransactionType && where?.name === 'DEPOSIT'
              ? { financialTransactionTypeKey: 1, name: 'DEPOSIT' }
              : where?.name === 'BOOKED'
                ? bookedStatus
                : where?.name === demoBudget.name
                  ? { budgetKey: 1, name: demoBudget.name }
                  : null,
    );
    em.count.mockImplementation(async (entity: unknown) =>
      entity === Transaction ? 25 : entity === FinancialTransaction ? 1 : entity === PortfolioSnapshot ? 30 : 0,
    );
    const service = createService(em, resolveIdentity, true, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(/Missing verified demo budget category/);
  });

  it('accepts numeric rounding differences within numeric(18,4) precision', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({ asOfDate, bankTransactions: [], portfolioTransactions: [] });
    const roundedBudgetRows = demoBudget.requiredCategories.map((_name, index) => {
      const expectedAmount = calculateAmountBudgeted({
        category: demoCategories[index] as Category,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
        totalHouseholdAnualizedMonthlyIncome: 2000,
      });

      return {
        accounts: { getItems: () => demoBudgetAccounts },
        amountBudgeted: index === 0 ? Number(expectedAmount.toFixed(4)) : expectedAmount,
        categoryKey: demoCategories[index],
        recurrency: 'MONTHLY',
      };
    });

    em.find.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Budget)
        return [
          {
            budgetKey: 1,
            currencyKey: demoAppuser.currencyKey,
            description: demoBudget.description,
            name: demoBudget.name,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
          },
        ];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === BudgetTemplateCategory) return roundedBudgetRows;
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) => {
      if (where?.name === 'BOOKED') return bookedStatus;
      if (where?.name === demoBudget.name)
        return {
          budgetKey: 1,
          currencyKey: demoAppuser.currencyKey,
          description: demoBudget.description,
          name: demoBudget.name,
          numAdults: demoBudget.numAdults,
          numDependents: demoBudget.numDependents,
        };
      if (entity === BudgetTemplateCategory && where?.categoryKey) {
        return roundedBudgetRows.find((row) => row.categoryKey?.categoryKey === where.categoryKey?.categoryKey);
      }
      if (entity === Transaction) return { transactionDate: asOfDate };
      return null;
    });
    em.count.mockImplementation(async (entity: unknown) => (entity === Transaction ? 25 : 0));

    const service = createService(em, resolveIdentity, true, { buildPlan });

    await expect(service.refresh({ asOfDate })).resolves.toMatchObject({ budgetVerified: true });
    expect(em.assign).not.toHaveBeenCalled();
  });

  it('throws when portfolio snapshots backfill is incomplete', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-00',
          feeAmount: 0,
          portfolioName: 'Long-term investments',
          quantity: 1,
          settlementAmount: 1,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    em.find.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Portfolio)
        return [
          {
            currencyKey: { code: 'EUR' },
            name: 'Long-term investments',
            portfolioKey: 1,
            portfolioOwnerAppuserKey: demoAppuser,
            tenantKey: demoTenant,
          },
        ];
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) =>
      entity === Transaction
        ? { transactionDate: asOfDate }
        : entity === PortfolioSnapshot
          ? { snapshotDate: asOfDate }
          : entity === FinancialAsset && where?.symbol === 'AAPL'
            ? { financialAssetKey: 7, symbol: 'AAPL' }
            : entity === FinancialTransactionType && where?.name === 'BUY'
              ? { financialTransactionTypeKey: 1, name: 'BUY' }
              : entity === FinancialBroker && where?.name === 'degiro'
                ? { financialBrokerKey: 22, name: 'degiro' }
                : where?.name === 'BOOKED'
                  ? bookedStatus
                  : where?.name === demoBudget.name
                    ? { budgetKey: 1, name: demoBudget.name }
                    : null,
    );
    em.count.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Transaction && where?.transactionDate?.$gte) return 25;
      if (entity === FinancialTransaction) return 1;
      if (entity === PortfolioSnapshot && where?.snapshotDate?.$gte) return 24;
      return 0;
    });
    const service = createService(em, resolveIdentity, true, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(/Expected at least 25 demo portfolio snapshots/);
    expect(em.count).toHaveBeenCalledWith(
      PortfolioSnapshot,
      expect.objectContaining({ snapshotDate: expect.objectContaining({ $lte: asOfDate }) }),
    );
  });

  it('throws when portfolio snapshots are missing', async () => {
    const em = createEm();
    const resolveIdentity = vi.fn().mockResolvedValue(foundIdentity);
    const asOfDate = new Date('2026-06-05T00:00:00.000Z');
    const buildPlan = vi.fn().mockReturnValue({
      asOfDate,
      bankTransactions: [],
      portfolioTransactions: [
        {
          externalTransactionId: 'DEMO-PORTFOLIO-TXN-LONG-TERM-AAPL-BUY-01',
          feeAmount: 0,
          portfolioName: 'Long-term investments',
          quantity: 1,
          settlementAmount: 1,
          symbol: 'AAPL',
          transactionDate: new Date('2026-05-12T00:00:00.000Z'),
          type: 'BUY',
        },
      ],
    });
    em.find.mockImplementation(async (entity: unknown, where: any) => {
      if (entity === Budget) return [{ budgetKey: 1, name: demoBudget.name }];
      if (entity === Category) return findDemoCategories(where);
      if (entity === Account) return demoBudgetAccounts;
      if (entity === Portfolio)
        return [
          {
            currencyKey: { code: 'EUR' },
            name: 'Long-term investments',
            portfolioKey: 1,
            portfolioOwnerAppuserKey: demoAppuser,
            tenantKey: demoTenant,
          },
        ];
      if (entity === BudgetTemplateCategory)
        return demoBudget.requiredCategories.map((_name, index) => ({
          accounts: { getItems: () => demoBudgetAccounts },
          amountBudgeted: calculateAmountBudgeted({
            category: demoCategories[index] as Category,
            numAdults: demoBudget.numAdults,
            numDependents: demoBudget.numDependents,
            totalHouseholdAnualizedMonthlyIncome: 2000,
          }),
          categoryKey: demoCategories[index],
          recurrency: 'MONTHLY',
        }));
      return [];
    });
    em.findOne.mockImplementation(async (entity: unknown, where: any) =>
      entity === BudgetTemplateCategory
        ? {
            accounts: { getItems: () => demoBudgetAccounts },
            amountBudgeted: calculateAmountBudgeted({
              category: demoCategories[0] as Category,
              numAdults: demoBudget.numAdults,
              numDependents: demoBudget.numDependents,
              totalHouseholdAnualizedMonthlyIncome: 2000,
            }),
            categoryKey: demoCategories[0],
            recurrency: 'MONTHLY',
          }
        : entity === PortfolioSnapshot
          ? { snapshotDate: asOfDate }
          : entity === FinancialAsset && where?.symbol === 'AAPL'
            ? { financialAssetKey: 7, symbol: 'AAPL' }
            : entity === Transaction
              ? { transactionDate: asOfDate }
              : entity === FinancialTransactionType && where?.name === 'BUY'
                ? { financialTransactionTypeKey: 1, name: 'BUY' }
                : entity === FinancialBroker && where?.name === 'degiro'
                  ? { financialBrokerKey: 22, name: 'degiro' }
                  : where?.name === 'BOOKED'
                    ? bookedStatus
                    : where?.name === demoBudget.name
                      ? { budgetKey: 1, name: demoBudget.name }
                      : null,
    );
    em.count.mockImplementation(async (entity: unknown, where?: any) => {
      if (entity === Transaction && where?.transactionDate?.$gte) return 25;
      if (entity === FinancialTransaction) return 1;
      if (entity === PortfolioSnapshot && where?.snapshotDate?.$gte) return 19;
      return 0;
    });
    const service = createService(em, resolveIdentity, true, { buildPlan });
    await expect(service.refresh()).rejects.toThrow(/Expected at least 25 demo portfolio snapshots/);
    expect(em.count).toHaveBeenCalledWith(
      PortfolioSnapshot,
      expect.objectContaining({ snapshotDate: expect.objectContaining({ $gte: expect.any(Date), $lte: asOfDate }) }),
    );
  });
});

/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
