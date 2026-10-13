import type { RequiredEntityData } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/core';
import { QueryOrder } from '@mikro-orm/core';

import { DI } from '@app/database/di';
import { HIDDEN_FILTER } from '@app/database/filters/tenant-filter';
import { demoBudget } from '@app/database/seeders/demo/demo-budget';
import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { Account } from '@entity/Account';
import { Appuser } from '@entity/Appuser';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { DEMO_BANK_TRANSACTION_ID_PREFIX, demoBankTransactionFixtures } from '@service/demo-data/demo-data-fixtures';
import {
  type DemoRefreshIdentityMissingReason,
  resolveDemoRefreshIdentity,
} from '@service/demo-data/demo-data-refresh-identity';
import { buildDemoRefreshPlan } from '@service/demo-data/demo-data-refresh-planner';
import portfolioSnapshotService from '@service/portfolio/portfolio-snapshot.service';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { calculateAmountBudgeted } from '@utils/budget';
import logger from '@utils/logger';

export interface DemoDataRefreshResult {
  budgetUpdated: boolean;
  budgetVerified: boolean;
  dryRun: boolean;
  planned: {
    bankTransactions: number;
    portfolioTransactions: number;
  };
  skipped?: boolean;
  skipReason?: DemoRefreshIdentityMissingReason;
}

export interface DemoDataRefreshServiceDeps {
  buildPlan?: typeof buildDemoRefreshPlan;
  em: EntityManager;
  logger?: Pick<typeof logger, 'warn'>;
  resolveIdentity?: typeof resolveDemoRefreshIdentity;
  verifyInvariants?: (
    em: EntityManager,
    asOfDate: Date,
    appuser: Appuser,
    tenant: Account['tenantKey'],
    affectedPortfolioTransactions: { portfolioName: string }[],
  ) => Promise<void>;
}

export class DemoDataRefreshService {
  constructor(private readonly deps: Partial<DemoDataRefreshServiceDeps> = {}) {}

  async refresh({
    asOfDate = new Date(),
    dryRun = false,
  }: { asOfDate?: Date; dryRun?: boolean } = {}): Promise<DemoDataRefreshResult> {
    const resolveIdentity = this.deps.resolveIdentity ?? resolveDemoRefreshIdentity;
    const buildPlan = this.deps.buildPlan ?? buildDemoRefreshPlan;
    const verifyInvariants = this.deps.verifyInvariants ?? this.verifyPostRefreshInvariants.bind(this);
    const em = this.deps.em ?? DI.em;

    const identity = await resolveIdentity(em);
    if (identity.status === 'missing') {
      const log = this.deps.logger ?? logger;
      log.warn({ reason: identity.reason }, 'Skipping demo data refresh because demo identity is missing');
      return {
        budgetUpdated: false,
        budgetVerified: false,
        dryRun,
        planned: { bankTransactions: 0, portfolioTransactions: 0 },
        skipped: true,
        skipReason: identity.reason,
      };
    }

    const { appuser, tenant } = identity;
    const plan = buildPlan({ asOfDate });

    const result: DemoDataRefreshResult = {
      budgetUpdated: false,
      budgetVerified: false,
      dryRun,
      planned: {
        bankTransactions: plan.bankTransactions.length,
        portfolioTransactions: plan.portfolioTransactions.length,
      },
    };

    if (dryRun) {
      const budgetResult = await this.refreshDemoBudget(em, appuser, tenant, plan.asOfDate, true);
      result.budgetUpdated = budgetResult.updated;
      result.budgetVerified = budgetResult.verified;
      return result;
    }

    let previousPortfolioTransactionDates = new Map<string, Date[]>();

    await em.transactional(async (tx) => {
      const transactionStatus = await tx.findOne(TransactionStatus, { name: 'BOOKED' });
      if (!transactionStatus) throw new Error('TransactionStatus not found: BOOKED');

      const preparedTransactions = await this.prepareBankTransactions(
        tx,
        plan.bankTransactions,
        appuser,
        tenant,
        transactionStatus,
      );

      const budgetResult = await this.refreshDemoBudget(tx, appuser, tenant, plan.asOfDate, dryRun);
      result.budgetUpdated = budgetResult.updated;
      result.budgetVerified = budgetResult.verified;

      this.applyBankTransactions(tx, preparedTransactions);
      await this.recomputeBalances(
        tx,
        preparedTransactions.map(({ account }) => account),
      );

      previousPortfolioTransactionDates = await this.upsertPortfolioTransactions(
        tx,
        plan.portfolioTransactions,
        appuser,
        tenant,
      );
      await tx.flush();
    });

    await this.backfillPortfolioSnapshots(
      em,
      plan.portfolioTransactions,
      previousPortfolioTransactionDates,
      plan.asOfDate,
      appuser,
      tenant,
    );

    await verifyInvariants(em, plan.asOfDate, appuser, tenant, plan.portfolioTransactions);

    return result;
  }

  private applyBankTransactions(
    em: EntityManager,
    preparedTransactions: { existingTransaction: null | Transaction; payload: Partial<Transaction> }[],
  ): void {
    for (const { existingTransaction, payload } of preparedTransactions) {
      if (existingTransaction) {
        em.assign(existingTransaction, payload);
      } else {
        em.persist(em.create(Transaction, payload as RequiredEntityData<Transaction>));
      }
    }
  }

  private async backfillPortfolioSnapshots(
    em: EntityManager,
    portfolioTransactions: { externalTransactionId: string; portfolioName: string; transactionDate: Date }[],
    previousPortfolioTransactionDates: Map<string, Date[]>,
    asOfDate: Date,
    appuser: Appuser,
    tenant: Account['tenantKey'],
  ): Promise<void> {
    const uniquePortfolios = [...new Set(portfolioTransactions.map((transaction) => transaction.portfolioName))];
    for (const portfolioName of uniquePortfolios) {
      const portfolioTxs = portfolioTransactions.filter((transaction) => transaction.portfolioName === portfolioName);
      const portfolio = await this.resolveDemoPortfolio(em, portfolioName, appuser, tenant);
      const previousDates = previousPortfolioTransactionDates.get(portfolioName) ?? [];
      const candidateDates = [
        subUtcDays(asOfDate, 30),
        ...portfolioTxs.map((transaction) => transaction.transactionDate),
        ...previousDates,
      ];
      const fromDate = candidateDates.reduce<Date | undefined>(
        (earliest, date) => (!earliest || date < earliest ? date : earliest),
        undefined,
      );
      await portfolioSnapshotService.backfillSnapshotsForPortfolio(portfolio.portfolioKey, fromDate, asOfDate);
    }
  }

  private buildDemoBankInternalTransactionId(externalTransactionId: string): string {
    return `${externalTransactionId}-INTERNAL`;
  }

  private buildDemoPortfolioInternalTransactionId(externalTransactionId: string): string {
    return `DEMO-PORTFOLIO-INTERNAL-${externalTransactionId}`;
  }

  private async ensureCurrentBudgetTemplateCategories(
    em: EntityManager,
    budget: Budget,
    appuser: Appuser,
    tenant: Account['tenantKey'],
    year: number,
    month: number,
    dryRun: boolean,
  ): Promise<{ updated: boolean; verified: boolean }> {
    const categories: Category[] = [];
    for (const name of demoBudget.requiredCategories) {
      const matches = await em.find(Category, {
        deletedAt: null,
        isDefaultBudgetCategory: true,
        isSystemCategory: true,
        name,
      });
      if (matches.length !== 1) {
        throw new Error(`Expected exactly one demo budget category for ${name}, found ${matches.length}`);
      }
      const category = matches.at(0);
      if (!category) throw new Error(`Expected exactly one demo budget category for ${name}, found 0`);
      categories.push(category);
    }

    const demoAccounts = await em.find(Account, {
      accountOwnerAppuserKey: appuser,
      deletedAt: null,
      tenantKey: tenant,
    });

    let updated = false;
    for (const category of categories) {
      const existingRow = await em.findOne(
        BudgetTemplateCategory,
        {
          budgetKey: budget,
          categoryKey: category,
          month,
          year,
        },
        { populate: ['accounts'] },
      );
      const amountBudgeted = calculateAmountBudgeted({
        category,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
        totalHouseholdAnualizedMonthlyIncome: 2000,
      });
      const recurrency = category.recurrency;
      const currentAccounts =
        (existingRow as null | { accounts?: { getItems: () => Account[] } })?.accounts?.getItems() ?? [];
      const accountsMatch =
        currentAccounts.length === demoAccounts.length &&
        demoAccounts.every((account) =>
          currentAccounts.some((currentAccount) => currentAccount.accountKey === account.accountKey),
        );
      const matches =
        !!existingRow &&
        amountsEqual(existingRow.amountBudgeted ?? 0, amountBudgeted) &&
        existingRow.recurrency === recurrency &&
        accountsMatch;

      if (matches) continue;
      updated = true;
      if (!dryRun) {
        if (existingRow) {
          em.assign(existingRow, { amountBudgeted, recurrency });
          const existingAccounts = (existingRow as { accounts?: { set?: (accounts: Account[]) => void } }).accounts;
          existingAccounts?.set?.(demoAccounts);
        } else {
          em.persist(
            em.create(BudgetTemplateCategory, {
              accounts: demoAccounts,
              amountBudgeted,
              budgetKey: budget,
              categoryKey: category,
              month,
              recurrency,
              year,
            } as RequiredEntityData<BudgetTemplateCategory>),
          );
        }
      }
    }

    return { updated, verified: !updated };
  }

  private getCurrentUtcYearMonth(asOfDate: Date): { month: number; year: number } {
    return { month: asOfDate.getUTCMonth() + 1, year: asOfDate.getUTCFullYear() };
  }

  private async prepareBankTransactions(
    em: EntityManager,
    plannedTransactions: {
      accountName: string;
      amount: number;
      description: string;
      descriptionDirty: string;
      externalTransactionId: string;
      merchant: string;
      transactionDate: Date;
      type: string;
    }[],
    appuser: Appuser,
    tenant: Account['tenantKey'],
    transactionStatus: TransactionStatus,
  ): Promise<
    {
      account: Account;
      existingTransaction: null | Transaction;
      merchant: TransactionMerchant;
      payload: Partial<Transaction>;
    }[]
  > {
    const sortedBankTransactions = [...plannedTransactions].sort((left, right) => {
      const dateDiff = left.transactionDate.getTime() - right.transactionDate.getTime();
      return dateDiff !== 0 ? dateDiff : left.externalTransactionId.localeCompare(right.externalTransactionId);
    });

    const prepared: {
      account: Account;
      existingTransaction: null | Transaction;
      merchant: TransactionMerchant;
      payload: Partial<Transaction>;
    }[] = [];

    for (const plannedTransaction of sortedBankTransactions) {
      const account = await this.resolveDemoAccount(em, plannedTransaction.accountName, appuser, tenant);
      const transactionType = await em.findOne(TransactionType, { name: plannedTransaction.type });
      if (!transactionType) throw new Error(`TransactionType not found: ${plannedTransaction.type}`);

      const normalizedName = normalizeMerchantName(plannedTransaction.merchant);
      let merchant = await em.findOne(TransactionMerchant, {
        name: plannedTransaction.merchant,
        normalizedName,
        tenantKey: tenant,
      });
      if (!merchant) {
        merchant = new TransactionMerchant();
        merchant.name = plannedTransaction.merchant;
        merchant.normalizedName = normalizedName;
        merchant.tenantKey = tenant;
        em.persist(merchant);
      }

      const currency = account.currencyKey;
      const appuserCurrencyKey = appuser.currencyKey;
      const accountBalance = account.balance ?? 0;
      const appuserBalance = account.appuserCurrencyBalance;
      const appuserRate = accountBalance !== 0 && appuserBalance != null ? appuserBalance / accountBalance : 1;
      const originalAmount = plannedTransaction.amount;
      const settlementAmount = plannedTransaction.amount;
      const appuserSettlementAmount = settlementAmount * appuserRate;

      const existingTransaction = await em.findOne(Transaction, {
        accountKey: account,
        appuserKey: appuser,
        deletedAt: null,
        externalTransactionId: plannedTransaction.externalTransactionId,
        tenantKey: tenant,
      });

      prepared.push({
        account,
        existingTransaction,
        merchant,
        payload: {
          accountKey: account,
          appuserCurrencyBalance: appuserSettlementAmount,
          appuserCurrencyExchangeRate: appuserRate,
          appuserCurrencyKey,
          appuserKey: appuser,
          appuserSettlementAmount,
          description: plannedTransaction.description,
          descriptionDirty: plannedTransaction.descriptionDirty,
          externalTransactionId: plannedTransaction.externalTransactionId,
          internalTransactionId: this.buildDemoBankInternalTransactionId(plannedTransaction.externalTransactionId),
          originalAmount,
          originalCurrencyKey: currency,
          settlementAmount,
          settlementCurrencyKey: currency,
          tenantKey: tenant,
          transactionDate: plannedTransaction.transactionDate,
          transactionMerchantKey: merchant,
          transactionStatusKey: transactionStatus,
          transactionTypeKey: transactionType,
        },
      });
    }

    return prepared;
  }

  private async recomputeBalances(em: EntityManager, accountKeys: Account[]): Promise<void> {
    const uniqueAccounts = [...new Map(accountKeys.map((account) => [account.accountKey, account])).values()];

    for (const account of uniqueAccounts) {
      const transactions = await em.find(
        Transaction,
        {
          accountKey: account,
          appuserKey: account.accountOwnerAppuserKey,
          deletedAt: null,
          tenantKey: account.tenantKey,
        },
        // Chronological running balances require date as the primary ordering.
        // RAD-25: balance recomputation must include hidden transactions so the stored running-balance
        // chain and account.balance stay physically accurate; already account/tenant-scoped.
        // eslint-disable-next-line perfectionist/sort-objects
        { filters: { [HIDDEN_FILTER]: false }, orderBy: { transactionDate: QueryOrder.ASC, externalTransactionId: QueryOrder.ASC } },
      );

      const openingBalance =
        (account.balance ?? 0) -
        transactions.reduce((sum, transaction) => sum + (transaction.settlementAmount ?? 0), 0);
      const openingAppuserBalance =
        (account.appuserCurrencyBalance ?? 0) -
        transactions.reduce((sum, transaction) => sum + (transaction.appuserSettlementAmount ?? 0), 0);

      let runningBalance = openingBalance;
      let runningAppuserBalance = openingAppuserBalance;
      for (const transaction of transactions) {
        runningBalance += transaction.settlementAmount ?? 0;
        runningAppuserBalance += transaction.appuserSettlementAmount ?? 0;
        transaction.balance = runningBalance;
        transaction.appuserCurrencyBalance = runningAppuserBalance;
      }

      account.balance = runningBalance;
      account.appuserCurrencyBalance = runningAppuserBalance;
      await em.flush();
    }
  }

  private async refreshDemoBudget(
    em: EntityManager,
    appuser: Appuser,
    tenant: Account['tenantKey'],
    asOfDate: Date,
    dryRun: boolean,
  ): Promise<{ updated: boolean; verified: boolean }> {
    const { month, year } = this.getCurrentUtcYearMonth(asOfDate);
    const existingBudget = await em.findOne(Budget, {
      appuserKey: appuser,
      deletedAt: null,
      name: demoBudget.name,
    });

    const currencyKey = await this.resolveDemoBudgetCurrency(em, appuser);

    const budgetPayload = {
      appuserKey: appuser,
      currencyKey,
      description: demoBudget.description,
      name: demoBudget.name,
      numAdults: demoBudget.numAdults,
      numDependents: demoBudget.numDependents,
      tenantKey: tenant,
    };

    if (!existingBudget) {
      if (dryRun) return { updated: true, verified: false };

      const createdBudget = em.create(Budget, budgetPayload as RequiredEntityData<Budget>);
      em.persist(createdBudget);
      await this.ensureCurrentBudgetTemplateCategories(em, createdBudget, appuser, tenant, year, month, dryRun);
      return { updated: true, verified: true };
    }

    const verified =
      existingBudget.description === demoBudget.description &&
      existingBudget.name === demoBudget.name &&
      existingBudget.currencyKey === currencyKey &&
      existingBudget.numAdults === demoBudget.numAdults &&
      existingBudget.numDependents === demoBudget.numDependents;

    const categoryResult = await this.ensureCurrentBudgetTemplateCategories(
      em,
      existingBudget,
      appuser,
      tenant,
      year,
      month,
      dryRun,
    );
    const updated = !verified || categoryResult.updated;

    if (dryRun) return { updated, verified: verified && categoryResult.verified };

    if (!verified) em.assign(existingBudget, budgetPayload);
    return { updated, verified: true };
  }

  private async resolveDemoAccount(
    em: EntityManager,
    accountName: string,
    appuser: Appuser,
    tenant: Account['tenantKey'],
  ): Promise<Account> {
    const accounts = await em.find(Account, {
      accountName,
      accountOwnerAppuserKey: appuser,
      deletedAt: null,
      tenantKey: tenant,
    });

    if (accounts.length !== 1) {
      throw new Error(`Expected exactly one demo bank account for ${accountName}, found ${accounts.length}`);
    }

    const account = accounts.at(0);
    if (account == null) throw new Error(`Expected exactly one demo bank account for ${accountName}, found 0`);
    return account;
  }

  private async resolveDemoBudgetCurrency(em: EntityManager, appuser: Appuser): Promise<Currency> {
    const appuserCurrencyKey = (appuser as Partial<Appuser>).currencyKey;
    if (appuserCurrencyKey) return appuserCurrencyKey;

    const currency = await em.findOne(Currency, { code: demoPersona.primaryCurrency });
    if (!currency) throw new Error(`Currency not found: ${demoPersona.primaryCurrency}`);
    return currency;
  }

  private async resolveDemoPortfolio(
    em: EntityManager,
    portfolioName: string,
    appuser: Appuser,
    tenant: Account['tenantKey'],
  ): Promise<Portfolio> {
    const portfolios = await em.find(Portfolio, {
      deletedAt: null,
      name: portfolioName,
      portfolioOwnerAppuserKey: appuser,
      tenantKey: tenant,
    });
    if (portfolios.length !== 1)
      throw new Error(`Expected exactly one demo portfolio for ${portfolioName}, found ${portfolios.length}`);
    const portfolio = portfolios.at(0);
    if (!portfolio) throw new Error(`Expected exactly one demo portfolio for ${portfolioName}, found 0`);
    return portfolio;
  }

  private async upsertPortfolioTransactions(
    em: EntityManager,
    plannedTransactions: {
      externalTransactionId: string;
      feeAmount: number;
      portfolioName: string;
      quantity: number;
      settlementAmount: number;
      symbol: string;
      transactionDate: Date;
      type: string;
    }[],
    appuser: Appuser,
    tenant: Account['tenantKey'],
  ): Promise<Map<string, Date[]>> {
    const previousPortfolioTransactionDates = new Map<string, Date[]>();

    for (const plannedTransaction of plannedTransactions) {
      const portfolio = await this.resolveDemoPortfolio(em, plannedTransaction.portfolioName, appuser, tenant);
      const transactionType = await em.findOne(FinancialTransactionType, { name: plannedTransaction.type });
      if (!transactionType) throw new Error(`FinancialTransactionType not found: ${plannedTransaction.type}`);
      const asset = await em.findOne(FinancialAsset, { symbol: plannedTransaction.symbol });
      if (!asset) throw new Error(`FinancialAsset not found: ${plannedTransaction.symbol}`);
      const broker = await em.findOne(FinancialBroker, { name: 'degiro' });
      if (!broker) throw new Error('FinancialBroker not found: degiro');

      const existingTransaction = await em.findOne(FinancialTransaction, {
        appuserKey: appuser,
        deletedAt: null,
        externalTransactionId: plannedTransaction.externalTransactionId,
        portfolioKey: portfolio,
        tenantKey: tenant,
      });

      if (existingTransaction?.transactionDate) {
        const dates = previousPortfolioTransactionDates.get(plannedTransaction.portfolioName) ?? [];
        dates.push(existingTransaction.transactionDate);
        previousPortfolioTransactionDates.set(plannedTransaction.portfolioName, dates);
      }

      const payload = {
        appuserCurrencyExchangeRate: 1,
        appuserKey: appuser,
        appuserSettlementAmount: plannedTransaction.settlementAmount,
        appuserUnitAmount:
          plannedTransaction.quantity !== 0
            ? plannedTransaction.settlementAmount / plannedTransaction.quantity
            : plannedTransaction.settlementAmount,
        externalTransactionId: plannedTransaction.externalTransactionId,
        feeAmount: plannedTransaction.feeAmount,
        feeCurrencyKey: portfolio.currencyKey,
        financialAssetKey: asset,
        financialBrokerKey: broker,
        financialTransactionTypeKey: transactionType,
        internalTransactionId: this.buildDemoPortfolioInternalTransactionId(plannedTransaction.externalTransactionId),
        portfolioKey: portfolio,
        quantity: plannedTransaction.quantity,
        settlementAmount: plannedTransaction.settlementAmount,
        settlementCurrencyKey: portfolio.currencyKey,
        settlementUnitAmount:
          plannedTransaction.quantity !== 0
            ? plannedTransaction.settlementAmount / plannedTransaction.quantity
            : plannedTransaction.settlementAmount,
        tenantKey: tenant,
        transactionDate: plannedTransaction.transactionDate,
      };

      if (portfolio.currencyKey.currencyKey !== appuser.currencyKey.currencyKey) {
        const exchangeRate = await em.findOne(
          ExchangeRate,
          {
            date: { $lte: plannedTransaction.transactionDate },
            fromCurrency: portfolio.currencyKey,
            toCurrency: appuser.currencyKey,
          },
          { orderBy: { date: 'desc' } },
        );
        if (!exchangeRate) {
          throw new Error(
            `Missing exchange rate for ${portfolio.currencyKey.code} to ${appuser.currencyKey.code} on ${plannedTransaction.transactionDate.toISOString()}`,
          );
        }
        payload.appuserCurrencyExchangeRate = exchangeRate.rate;
        payload.appuserSettlementAmount = plannedTransaction.settlementAmount * exchangeRate.rate;
        payload.appuserUnitAmount =
          plannedTransaction.quantity !== 0
            ? (plannedTransaction.settlementAmount / plannedTransaction.quantity) * exchangeRate.rate
            : plannedTransaction.settlementAmount * exchangeRate.rate;
      }

      if (existingTransaction) em.assign(existingTransaction, payload);
      else em.persist(em.create(FinancialTransaction, payload as RequiredEntityData<FinancialTransaction>));
    }

    return previousPortfolioTransactionDates;
  }

  private async verifyPostRefreshInvariants(
    em: EntityManager,
    asOfDate: Date,
    appuser: Appuser,
    tenant: Account['tenantKey'],
    affectedPortfolioTransactions: { portfolioName: string; transactionDate: Date; type: string }[],
  ): Promise<void> {
    const asOfMinusOneDay = subUtcDays(asOfDate, 1);
    const recentBankCutoff = subUtcDays(asOfDate, 30);
    const affectedPortfolios = [
      ...new Set(affectedPortfolioTransactions.map((transaction) => transaction.portfolioName)),
    ];

    const maxBankTransaction = await em.findOne(
      Transaction,
      {
        appuserKey: appuser,
        deletedAt: null,
        externalTransactionId: { $like: `${DEMO_BANK_TRANSACTION_ID_PREFIX}%` },
        tenantKey: tenant,
        transactionDate: { $lte: asOfDate },
      },
      { orderBy: { transactionDate: QueryOrder.DESC } },
    );
    if (!maxBankTransaction?.transactionDate || maxBankTransaction.transactionDate < asOfMinusOneDay) {
      throw new Error(
        `Demo bank transactions are stale: latest ${maxBankTransaction?.transactionDate?.toISOString() ?? 'none'} < ${asOfMinusOneDay.toISOString()}`,
      );
    }

    const recentBankTransactions = await em.count(Transaction, {
      appuserKey: appuser,
      deletedAt: null,
      externalTransactionId: { $like: `${DEMO_BANK_TRANSACTION_ID_PREFIX}%` },
      tenantKey: tenant,
      transactionDate: { $gte: recentBankCutoff, $lte: asOfDate },
    });
    const bankThreshold = Math.max(
      10,
      demoBankTransactionFixtures.filter((fixture) => fixture.offsetDays <= 30).length,
    );
    if (recentBankTransactions < bankThreshold) {
      throw new Error(
        `Expected at least ${bankThreshold} demo bank transactions in the last 30 days, found ${recentBankTransactions}`,
      );
    }

    const budget = await em.findOne(Budget, { appuserKey: appuser, deletedAt: null, name: demoBudget.name });
    if (!budget) throw new Error(`Budget not found: ${demoBudget.name}`);

    const currentMonthCategories = await em.find(
      BudgetTemplateCategory,
      {
        budgetKey: budget,
        categoryKey: { name: { $in: [...demoBudget.requiredCategories] } },
        month: asOfDate.getUTCMonth() + 1,
        year: asOfDate.getUTCFullYear(),
      },
      { populate: ['accounts', 'categoryKey'] },
    );
    const demoAccounts = await em.find(Account, {
      accountOwnerAppuserKey: appuser,
      deletedAt: null,
      tenantKey: tenant,
    });
    const verifiedCategoryNames = new Set<string>();
    for (const row of currentMonthCategories) {
      const category = row.categoryKey as Category;
      const expectedAmount = calculateAmountBudgeted({
        category,
        numAdults: demoBudget.numAdults,
        numDependents: demoBudget.numDependents,
        totalHouseholdAnualizedMonthlyIncome: 2000,
      });
      const accounts = row.accounts.getItems();
      const accountsMatch =
        accounts.length === demoAccounts.length &&
        demoAccounts.every((account) => accounts.some((current) => current.accountKey === account.accountKey));
      const amountMatches = amountsEqual(Number(row.amountBudgeted), expectedAmount);
      if (!amountMatches || row.recurrency !== category.recurrency || !accountsMatch) {
        throw new Error(`Demo budget category not verified for ${category.name}`);
      }
      verifiedCategoryNames.add(category.name);
    }
    for (const requiredCategory of demoBudget.requiredCategories) {
      if (!verifiedCategoryNames.has(requiredCategory))
        throw new Error(`Missing verified demo budget category: ${requiredCategory}`);
    }

    for (const portfolioName of affectedPortfolios) {
      const portfolio = await this.resolveDemoPortfolio(em, portfolioName, appuser, tenant);
      const portfolioTransactions = affectedPortfolioTransactions.filter(
        (transaction) => transaction.portfolioName === portfolioName,
      );
      const valuedTransactionDates = portfolioTransactions
        .filter((transaction) => ['BUY', 'SELL'].includes(transaction.type))
        .map((transaction) => transaction.transactionDate);
      const earliestValuedTransactionDate = valuedTransactionDates.reduce<Date | undefined>(
        (earliest, date) => (!earliest || date < earliest ? date : earliest),
        undefined,
      );
      const effectiveSnapshotCutoff = earliestValuedTransactionDate
        ? new Date(Math.max(earliestValuedTransactionDate.getTime(), recentBankCutoff.getTime()))
        : recentBankCutoff;
      const snapshotCount = await em.count(PortfolioSnapshot, {
        deletedAt: null,
        portfolioKey: portfolio,
        snapshotDate: { $gte: effectiveSnapshotCutoff, $lte: asOfDate },
      });
      const latestSnapshot = await em.findOne(
        PortfolioSnapshot,
        { deletedAt: null, portfolioKey: portfolio },
        { orderBy: { snapshotDate: QueryOrder.DESC } },
      );
      const expectedMinimum = earliestValuedTransactionDate
        ? Math.max(1, Math.ceil((addUtcDays(asOfDate, 1).getTime() - effectiveSnapshotCutoff.getTime()) / 86400000))
        : 0;
      const snapshotDate = latestSnapshot?.snapshotDate ?? null;
      if (!snapshotDate || snapshotDate < asOfDate) {
        throw new Error(
          `Demo portfolio snapshots are stale: latest ${snapshotDate?.toISOString() ?? 'none'} < ${asOfDate.toISOString()}`,
        );
      }
      if (snapshotCount < expectedMinimum) {
        throw new Error(
          `Expected at least ${expectedMinimum} demo portfolio snapshots for ${portfolioName}, found ${snapshotCount}`,
        );
      }
    }
  }
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function amountsEqual(left: number, right: number): boolean {
  return Number(left.toFixed(4)) === Number(right.toFixed(4));
}

function subUtcDays(date: Date, days: number): Date {
  return addUtcDays(date, -days);
}

export default new DemoDataRefreshService();
