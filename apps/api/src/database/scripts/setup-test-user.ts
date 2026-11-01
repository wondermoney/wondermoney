/**
 * Standalone script to create a test user with realistic data across all features:
 * - Bank account + transactions
 * - Budget with income and category templates
 * - Portfolio + financial transactions + snapshots
 *
 * Usage: pnpm setup:test
 */

import { MikroORM } from '@mikro-orm/core';
import { startOfDay, startOfToday, subDays } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@entity/Account';
import { AccountType } from '@entity/AccountType';
import { Appuser, SupportedLanguages } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import { FinancialBroker } from '@entity/FinancialBroker';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Goal, GoalStatus } from '@entity/Goal';
import { GoalActivity, GoalActivityType } from '@entity/GoalActivity';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Tenant } from '@entity/Tenant';
import { TenantStatus } from '@entity/TenantStatus';
import { Transaction } from '@entity/Transaction';
import { TransactionMerchant } from '@entity/TransactionMerchant';
import { TransactionStatus } from '@entity/TransactionStatus';
import { TransactionType } from '@entity/TransactionType';
import { normalizeMerchantName } from '@service/transaction/merchant-normalization';
import { calculateAmountBudgeted, Recurrency } from '@utils/budget';
import { getRef } from '@utils/em-helpers';

import config from '../../mikro-orm.config';
import { createUser } from '../utils/better-auth-user';
import { transactionTemplates } from '../utils/transactions';

const EXCHANGE_RATE_USD_TO_EUR = 0.94;

async function main() {
  console.log('Initializing MikroORM...');
  const orm = await MikroORM.init(config);
  const em = orm.em.fork();

  try {
    // ──────────────────────────────────────────
    // 1. Create user via better-auth
    // ──────────────────────────────────────────
    const timestamp = Date.now();
    const email = `test-dev-${timestamp}@wonder.money`;
    const password = 'TestPassword123!';

    console.log(`Creating better-auth user: ${email}`);
    const { id: externalUserId } = await createUser({ email, password });
    console.log(`better-auth user created: ${externalUserId}`);

    // ──────────────────────────────────────────
    // 2. Create app user, tenant, subscription
    // ──────────────────────────────────────────
    const eurCurrency = await em.findOneOrFail(Currency, { code: 'EUR' });
    const usdCurrency = await em.findOneOrFail(Currency, { code: 'USD' });

    const appuser = new Appuser();
    appuser.emailAddress = email;
    appuser.externalUserId = externalUserId;
    appuser.firstName = 'Test';
    appuser.lastName = 'User';
    appuser.currencyKey = eurCurrency;
    appuser.language = SupportedLanguages.EN;
    appuser.emailAuthenticated = new Date();
    await em.persist(appuser).flush();
    console.log(`App user created: appuserKey=${appuser.appuserKey}`);

    const activeTenantStatus = await em.findOneOrFail(TenantStatus, { description: 'Active' });
    const tenant = new Tenant();
    tenant.name = 'Test User';
    tenant.ownerAppuserKey = appuser;
    tenant.tentantStatusKey = activeTenantStatus;
    await em.persist(tenant).flush();

    const appuserTenant = new AppuserTenant();
    appuserTenant.appuserKey = appuser;
    appuserTenant.tenantKey = tenant;
    await em.persist(appuserTenant).flush();

    console.log(`Tenant created`);

    // ──────────────────────────────────────────
    // 3. Bank account + transactions
    // ──────────────────────────────────────────
    const accountType = await em.findOneOrFail(AccountType, { description: 'CHECKING' });
    const transactionStatusBooked = await em.findOneOrFail(TransactionStatus, { name: 'BOOKED' });

    const account = new Account();
    account.accountName = 'Test Current Account';
    account.currencyKey = eurCurrency;
    account.accountOwnerAppuserKey = appuser;
    account.tenantKey = tenant;
    account.accountTypeKey = accountType;
    await em.persist(account).flush();

    const MAX_TRANSACTION_DAYS = 365;
    const initialBalance = 1000;
    const unsortedTransactions: Transaction[] = [];
    const totalTemplateTransactions = transactionTemplates.reduce((acc, t) => acc + t.count, 0);
    const daysInterval = Math.floor(MAX_TRANSACTION_DAYS / totalTemplateTransactions);
    let currentDate = startOfToday();

    for (const template of transactionTemplates) {
      for (let i = 0; i < template.count; i++) {
        const transactionAmount = Math.random() * (template.maxValue - template.minValue + 1) + template.minValue;
        const transactionDate = subDays(currentDate, daysInterval * i);

        const transaction = new Transaction();
        transaction.accountKey = account;
        transaction.tenantKey = tenant;
        transaction.appuserKey = appuser;
        const transactionType = await em.findOneOrFail(TransactionType, { name: template.type });
        transaction.transactionTypeKey = transactionType;
        transaction.transactionDate = transactionDate;
        transaction.originalCurrencyKey = eurCurrency;
        transaction.originalAmount = transactionAmount;
        transaction.settlementCurrencyKey = eurCurrency;
        transaction.settlementAmount = transactionAmount;
        transaction.appuserCurrencyKey = eurCurrency;
        transaction.appuserSettlementAmount = transactionAmount;
        transaction.description = template.description;
        transaction.descriptionDirty = template.descriptionDirty;
        transaction.transactionStatusKey = transactionStatusBooked;
        const normalizedName = normalizeMerchantName(template.merchant);
        let merchant = await em.findOne(TransactionMerchant, {
          name: template.merchant,
          normalizedName,
          tenantKey: tenant,
        });
        if (!merchant) {
          merchant = new TransactionMerchant();
          merchant.name = template.merchant;
          merchant.normalizedName = normalizedName;
          merchant.tenantKey = tenant;
          await em.persist(merchant).flush();
        }
        transaction.transactionMerchantKey = merchant;
        transaction.externalTransactionId = uuidv4();
        transaction.internalTransactionId = uuidv4();
        transaction.reviewed = Math.random() > 0.15;
        transaction.processed = true;
        transaction.createdAt = new Date();
        transaction.updatedAt = new Date();

        unsortedTransactions.push(transaction);
      }
      currentDate = subDays(currentDate, daysInterval * template.count);
    }

    const sortedTransactions = unsortedTransactions.toSorted(
      (a, b) => b.transactionDate!.getTime() - a.transactionDate!.getTime(),
    );

    let runningBalance = initialBalance;
    for (let i = sortedTransactions.length - 1; i >= 0; i--) {
      const transaction = sortedTransactions[i]!;
      runningBalance += transaction.originalAmount!;
      transaction.balance = runningBalance;
      transaction.appuserCurrencyBalance = runningBalance;
    }

    await em.persist(sortedTransactions).flush();

    // Update account balance
    account.balance = runningBalance;
    account.appuserCurrencyBalance = runningBalance;
    await em.persist(account).flush();
    console.log(`Bank account created with ${sortedTransactions.length} transactions`);

    // ──────────────────────────────────────────
    // 4. Goals
    // ──────────────────────────────────────────
    const goalSpecs = [
      {
        activities: [
          { amount: 4000, occurredAt: subDays(startOfToday(), 120), type: GoalActivityType.ASSIGNED },
          { amount: 1000, occurredAt: subDays(startOfToday(), 45), type: GoalActivityType.MOVED_IN },
        ],
        description: 'Cash reserve for unexpected expenses',
        name: 'Emergency Fund',
        priority: 0,
        targetAmount: 5000,
        targetDate: subDays(startOfToday(), 90),
      },
      {
        activities: [{ amount: 800, occurredAt: subDays(startOfToday(), 30), type: GoalActivityType.ASSIGNED }],
        description: 'Trip savings for next year',
        name: 'Vacation 2026',
        priority: 1,
        targetAmount: 3000,
        targetDate: new Date(new Date().getFullYear() + 1, 5, 15),
      },
      {
        activities: [
          { amount: 400, occurredAt: subDays(startOfToday(), 180), type: GoalActivityType.ASSIGNED },
          { amount: 150, occurredAt: subDays(startOfToday(), 20), type: GoalActivityType.MOVED_OUT },
        ],
        description: 'Set aside money for yearly tax bill',
        name: 'Taxes',
        priority: 2,
        targetAmount: 1200,
        targetDate: subDays(startOfToday(), 60),
      },
    ] as const;

    const goals: Goal[] = [];
    const goalActivities: GoalActivity[] = [];
    for (const spec of goalSpecs) {
      const goal = new Goal();
      goal.appuserKey = appuser;
      goal.currencyKey = eurCurrency;
      goal.name = spec.name;
      goal.description = spec.description;
      goal.priority = spec.priority;
      goal.status = GoalStatus.ACTIVE;
      goal.targetAmount = spec.targetAmount;
      goal.targetDate = spec.targetDate;
      goal.tenantKey = tenant;
      goals.push(goal);

      const createdActivity = new GoalActivity();
      createdActivity.appuserKey = appuser;
      createdActivity.goalKey = goal;
      createdActivity.tenantKey = tenant;
      createdActivity.type = GoalActivityType.GOAL_CREATED;
      createdActivity.occurredAt = subDays(startOfToday(), 180);
      goalActivities.push(createdActivity);

      for (const activitySpec of spec.activities) {
        const activity = new GoalActivity();
        activity.amount = activitySpec.amount;
        activity.appuserKey = appuser;
        activity.createdByAppuserKey = appuser;
        activity.currencyKey = eurCurrency;
        activity.goalKey = goal;
        activity.tenantKey = tenant;
        activity.type = activitySpec.type;
        activity.occurredAt = activitySpec.occurredAt;
        goalActivities.push(activity);
      }
    }

    await em.persist([...goals, ...goalActivities]).flush();
    console.log(`Goals created with ${goalActivities.length} activities`);

    // ──────────────────────────────────────────
    // 5. Budget
    // ──────────────────────────────────────────
    const budget = new Budget();
    budget.appuserKey = appuser;
    budget.tenantKey = tenant;
    budget.currencyKey = eurCurrency;
    budget.name = 'Monthly Budget';
    budget.numAdults = 2;
    budget.numDependents = 1;
    await em.persist(budget).flush();

    const income1 = new BudgetTemplateIncome();
    income1.budgetKey = budget;
    income1.name = 'Salary';
    income1.amount = 3000;
    income1.recurrency = Recurrency.MONTHLY;
    em.persist(income1);

    const income2 = new BudgetTemplateIncome();
    income2.budgetKey = budget;
    income2.name = 'Partner Salary';
    income2.amount = 2500;
    income2.recurrency = Recurrency.MONTHLY;
    em.persist(income2);
    await em.flush();

    const totalHouseholdAnualizedMonthlyIncome = (income1.amount + income2.amount); // both MONTHLY, so amount/12*12 = amount
    const defaultBudgetCategories = await em.find(Category, {
      deletedAt: null,
      isDefaultBudgetCategory: true,
    });

    const currentYear = new Date().getFullYear();
    for (let month = 1; month <= 12; month++) {
      for (const category of defaultBudgetCategories) {
        const btc = new BudgetTemplateCategory();
        btc.budgetKey = budget;
        btc.categoryKey = category;
        btc.year = currentYear;
        btc.month = month;
        btc.recurrency = category.recurrency;
        btc.amountBudgeted = calculateAmountBudgeted({
          category,
          numAdults: 2,
          numDependents: 1,
          totalHouseholdAnualizedMonthlyIncome,
        });
        em.persist(btc);
      }
    }
    await em.flush();
    console.log(`Budget created with ${defaultBudgetCategories.length} categories x 12 months`);

    // ──────────────────────────────────────────
    // 6. Portfolio + Financial Transactions
    // ──────────────────────────────────────────
    const portfolio = new Portfolio();
    portfolio.name = 'Investment Portfolio';
    portfolio.currencyKey = eurCurrency;
    portfolio.portfolioOwnerAppuserKey = appuser;
    portfolio.tenantKey = tenant;
    portfolio.benchmarkSymbol = 'SPY';
    await em.persist(portfolio).flush();

    // Look up required entities
    const assets: Record<string, FinancialAsset> = {};
    for (const symbol of ['AAPL', 'GOOGL', 'NVDA', 'INTC']) {
      const asset = await em.findOne(FinancialAsset, { symbol });
      if (asset) assets[symbol] = asset;
    }
    const cashEurAsset = await em.findOne(FinancialAsset, { symbol: 'CURRENCY_EUR' });
    const degiro = await em.findOneOrFail(FinancialBroker, { name: 'degiro' });

    const ftTypes: Record<string, FinancialTransactionType> = {};
    for (const name of ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'DIVIDEND']) {
      ftTypes[name] = await em.findOneOrFail(FinancialTransactionType, { name });
    }

    const today = startOfToday();

    // Helper to create a financial transaction
    function createFT(params: {
      asset: FinancialAsset;
      daysAgo: number;
      feeAmount: number;
      originalAmount: number;
      originalCurrency: Currency;
      quantity: number;
      type: string;
    }) {
      const ft = new FinancialTransaction();
      ft.portfolioKey = portfolio;
      ft.tenantKey = tenant;
      ft.appuserKey = appuser;
      ft.financialAssetKey = params.asset;
      ft.financialBrokerKey = degiro;
      ft.financialTransactionTypeKey = ftTypes[params.type];
      ft.transactionDate = startOfDay(subDays(today, params.daysAgo));
      ft.quantity = params.quantity;
      ft.originalAmount = params.originalAmount;
      ft.originalCurrencyKey = params.originalCurrency;
      ft.originalUnitAmount = params.quantity !== 0 ? Math.abs(params.originalAmount / params.quantity) : params.originalAmount;
      ft.internalTransactionId = uuidv4();
      ft.externalTransactionId = uuidv4();
      ft.feeAmount = params.feeAmount;
      ft.feeCurrencyKey = eurCurrency;

      const isEurOriginal = params.originalCurrency.code === 'EUR';
      if (isEurOriginal) {
        ft.settlementAmount = params.originalAmount;
        ft.settlementCurrencyKey = eurCurrency;
        ft.settlementUnitAmount = ft.originalUnitAmount;
        ft.appuserSettlementAmount = params.originalAmount;
        ft.appuserUnitAmount = ft.originalUnitAmount;
      } else {
        ft.settlementAmount = Math.round(params.originalAmount * EXCHANGE_RATE_USD_TO_EUR * 100) / 100;
        ft.settlementCurrencyKey = eurCurrency;
        ft.settlementExchangeRate = EXCHANGE_RATE_USD_TO_EUR;
        ft.settlementUnitAmount = Math.round(ft.originalUnitAmount * EXCHANGE_RATE_USD_TO_EUR * 100) / 100;
        ft.appuserSettlementAmount = ft.settlementAmount;
        ft.appuserUnitAmount = ft.settlementUnitAmount;
      }

      em.persist(ft);
      return ft;
    }

    // Financial transactions (20 entries spread over 365 days)
    const financialTransactions: FinancialTransaction[] = [];

    // 1. DEPOSIT: 5000 EUR
    financialTransactions.push(createFT({ asset: cashEurAsset!, daysAgo: 365, feeAmount: 5, originalAmount: 5000, originalCurrency: eurCurrency, quantity: 1, type: 'DEPOSIT' }));
    // 2. BUY AAPL: 3 shares @ ~120 USD
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 350, feeAmount: 1.42, originalAmount: 360, originalCurrency: usdCurrency, quantity: 3, type: 'BUY' }));
    // 3. BUY GOOGL: 5 shares @ ~80 USD
    financialTransactions.push(createFT({ asset: assets['GOOGL']!, daysAgo: 320, feeAmount: 3.76, originalAmount: 400, originalCurrency: usdCurrency, quantity: 5, type: 'BUY' }));
    // 4. BUY NVDA: 4 shares @ ~132 USD
    financialTransactions.push(createFT({ asset: assets['NVDA']!, daysAgo: 290, feeAmount: 1.32, originalAmount: 528, originalCurrency: usdCurrency, quantity: 4, type: 'BUY' }));
    // 5. DEPOSIT: 3000 EUR
    financialTransactions.push(createFT({ asset: cashEurAsset!, daysAgo: 270, feeAmount: 3, originalAmount: 3000, originalCurrency: eurCurrency, quantity: 1, type: 'DEPOSIT' }));
    // 6. BUY INTC: 10 shares @ ~23 USD
    financialTransactions.push(createFT({ asset: assets['INTC']!, daysAgo: 250, feeAmount: 0.23, originalAmount: 230, originalCurrency: usdCurrency, quantity: 10, type: 'BUY' }));
    // 7. BUY AAPL: 2 shares @ ~125 USD
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 220, feeAmount: 2.1, originalAmount: 250, originalCurrency: usdCurrency, quantity: 2, type: 'BUY' }));
    // 8. SELL GOOGL: -2 shares @ ~85 USD
    financialTransactions.push(createFT({ asset: assets['GOOGL']!, daysAgo: 190, feeAmount: 1.5, originalAmount: 170, originalCurrency: usdCurrency, quantity: -2, type: 'SELL' }));
    // 9. DIVIDEND AAPL: 0.96 per share x 5 shares
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 180, feeAmount: 0, originalAmount: 4.8, originalCurrency: usdCurrency, quantity: 1, type: 'DIVIDEND' }));
    // 10. BUY NVDA: 3 shares @ ~140 USD
    financialTransactions.push(createFT({ asset: assets['NVDA']!, daysAgo: 150, feeAmount: 2.8, originalAmount: 420, originalCurrency: usdCurrency, quantity: 3, type: 'BUY' }));
    // 11. SELL NVDA: -2 shares @ ~145 USD
    financialTransactions.push(createFT({ asset: assets['NVDA']!, daysAgo: 120, feeAmount: 2.1, originalAmount: 290, originalCurrency: usdCurrency, quantity: -2, type: 'SELL' }));
    // 12. BUY GOOGL: 3 shares @ ~90 USD
    financialTransactions.push(createFT({ asset: assets['GOOGL']!, daysAgo: 100, feeAmount: 3.2, originalAmount: 270, originalCurrency: usdCurrency, quantity: 3, type: 'BUY' }));
    // 13. DEPOSIT: 2000 EUR
    financialTransactions.push(createFT({ asset: cashEurAsset!, daysAgo: 90, feeAmount: 2, originalAmount: 2000, originalCurrency: eurCurrency, quantity: 1, type: 'DEPOSIT' }));
    // 14. BUY AAPL: 2 shares @ ~130 USD
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 80, feeAmount: 1.8, originalAmount: 260, originalCurrency: usdCurrency, quantity: 2, type: 'BUY' }));
    // 15. SELL INTC: -5 shares @ ~25 USD
    financialTransactions.push(createFT({ asset: assets['INTC']!, daysAgo: 60, feeAmount: 0.5, originalAmount: 125, originalCurrency: usdCurrency, quantity: -5, type: 'SELL' }));
    // 16. DIVIDEND AAPL: 0.96 per share x 7 shares
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 45, feeAmount: 0, originalAmount: 6.72, originalCurrency: usdCurrency, quantity: 1, type: 'DIVIDEND' }));
    // 17. BUY NVDA: 2 shares @ ~150 USD
    financialTransactions.push(createFT({ asset: assets['NVDA']!, daysAgo: 30, feeAmount: 2.5, originalAmount: 300, originalCurrency: usdCurrency, quantity: 2, type: 'BUY' }));
    // 18. WITHDRAWAL: -1000 EUR
    financialTransactions.push(createFT({ asset: cashEurAsset!, daysAgo: 20, feeAmount: 1, originalAmount: -1000, originalCurrency: eurCurrency, quantity: 1, type: 'WITHDRAWAL' }));
    // 19. SELL AAPL: -3 shares @ ~135 USD
    financialTransactions.push(createFT({ asset: assets['AAPL']!, daysAgo: 10, feeAmount: 2.2, originalAmount: 405, originalCurrency: usdCurrency, quantity: -3, type: 'SELL' }));
    // 20. DIVIDEND GOOGL: 0.20 per share x 6 shares
    financialTransactions.push(createFT({ asset: assets['GOOGL']!, daysAgo: 5, feeAmount: 0, originalAmount: 1.2, originalCurrency: usdCurrency, quantity: 1, type: 'DIVIDEND' }));

    await em.flush();
    console.log(`Portfolio created with ${financialTransactions.length} financial transactions`);

    // ──────────────────────────────────────────
    // 6. Portfolio Snapshots
    // ──────────────────────────────────────────
    // Use a fresh forked EM to avoid auto-flush conflicts with pending entities
    const emSnap = orm.em.fork();

    // Load all prices upfront
    const pricesBySymbol: Record<string, { date: Date; price: number }[]> = {};
    for (const symbol of Object.keys(assets)) {
      const prices = await emSnap.find(
        FinancialAssetPrice,
        { financialAssetKey: assets[symbol]! },
        { orderBy: { date: 'ASC' } },
      );
      pricesBySymbol[symbol] = prices.map((p) => ({ date: p.date, price: p.price }));
    }

    // Sort transactions by date for snapshot calculation
    const sortedFT = financialTransactions
      .filter((ft) => ft.transactionDate)
      .toSorted((a, b) => a.transactionDate!.getTime() - b.transactionDate!.getTime());

    const earliestFTDate = sortedFT[0]?.transactionDate;
    if (earliestFTDate) {
      const holdings: Record<string, { quantity: number; totalCost: number }> = {};
      let ftIdx = 0;
      // Use UTC dates to avoid DST issues with the date column type
      let snapshotDate = new Date(Date.UTC(earliestFTDate.getFullYear(), earliestFTDate.getMonth(), earliestFTDate.getDate()));
      const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
      let snapshotsCreated = 0;

      while (snapshotDate <= todayUTC) {
        // Process transactions up to this date
        const snapshotTime = snapshotDate.getTime();
        while (ftIdx < sortedFT.length) {
          const ftDate = sortedFT[ftIdx]!.transactionDate!;
          const ftUTC = new Date(Date.UTC(ftDate.getFullYear(), ftDate.getMonth(), ftDate.getDate()));
          if (ftUTC.getTime() > snapshotTime) break;
          const ft = sortedFT[ftIdx]!;
          const typeName = ft.financialTransactionTypeKey?.name;
          const assetSymbol = ft.financialAssetKey?.symbol;

          if (assetSymbol && !assetSymbol.startsWith('CURRENCY_') && (typeName === 'BUY' || typeName === 'SELL')) {
            const h = (holdings[assetSymbol] ??= { quantity: 0, totalCost: 0 });
            h.quantity += ft.quantity;
            if (typeName === 'BUY') {
              h.totalCost += Math.abs(ft.settlementAmount);
            } else if (h.quantity > 0) {
              const prevQuantity = h.quantity - ft.quantity;
              if (prevQuantity > 0) {
                h.totalCost = (h.totalCost / prevQuantity) * h.quantity;
              }
            }
          }
          ftIdx++;
        }

        // Calculate total value from pre-loaded price data
        let totalValue = 0;
        let costBasis = 0;

        for (const [symbol, holding] of Object.entries(holdings)) {
          if (holding.quantity <= 0) continue;

          const symbolPrices = pricesBySymbol[symbol];
          if (!symbolPrices) continue;

          let price: null | number = null;
          for (let i = symbolPrices.length - 1; i >= 0; i--) {
            if (symbolPrices[i]!.date.getTime() <= snapshotTime) {
              price = symbolPrices[i]!.price;
              break;
            }
          }

          if (price !== null) {
            totalValue += holding.quantity * price * EXCHANGE_RATE_USD_TO_EUR;
            costBasis += holding.totalCost;
          }
        }

        if (totalValue > 0) {
          const snapshot = new PortfolioSnapshot();
          snapshot.portfolioKey = getRef(emSnap, Portfolio, portfolio.portfolioKey);
          snapshot.currencyKey = getRef(emSnap, Currency, eurCurrency.currencyKey);
          snapshot.snapshotDate = snapshotDate;
          snapshot.totalValue = Math.round(totalValue * 100) / 100;
          snapshot.costBasis = Math.round(costBasis * 100) / 100;
          emSnap.persist(snapshot);
          snapshotsCreated++;
        }

        // Advance by exactly one day in UTC
        snapshotDate = new Date(Date.UTC(snapshotDate.getUTCFullYear(), snapshotDate.getUTCMonth(), snapshotDate.getUTCDate() + 1));
      }

      await emSnap.flush();
      console.log(`Created ${snapshotsCreated} portfolio snapshots`);
    }

    // ──────────────────────────────────────────
    // Summary
    // ──────────────────────────────────────────
    console.log('\n========================================');
    console.log('  Test User Setup Complete!');
    console.log('========================================');
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}`);
    console.log(`  AppuserKey: ${appuser.appuserKey}`);
    console.log(`  TenantKey:  ${tenant.tenantKey}`);
    console.log('');
    console.log('  Data created:');
    console.log(`    - Bank account with ${sortedTransactions.length} transactions`);
    console.log(`    - Budget with ${defaultBudgetCategories.length} categories x 12 months`);
    console.log(`    - Portfolio with ${financialTransactions.length} financial transactions`);
    console.log('========================================\n');
  } catch (error) {
    console.error('Error setting up test user:', error);
    throw error;
  } finally {
    await orm.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
