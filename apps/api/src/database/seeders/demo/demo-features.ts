import type { EntityData, EntityManager, EntityName, FilterQuery } from '@mikro-orm/core';
import { addMonths, subMonths } from 'date-fns';

import { Account } from '@entity/Account';
import type { Appuser } from '@entity/Appuser';
import { AppuserMerchantCategory, Source as MerchantCategorySource } from '@entity/AppuserMerchantCategory';
import { AppuserTransactionCategory, Source } from '@entity/AppuserTransactionCategory';
import { Budget } from '@entity/Budget';
import { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { Category } from '@entity/Category';
import { Goal, GoalType } from '@entity/Goal';
import { GoalAccountLink } from '@entity/GoalAccountLink';
import { Loan } from '@entity/Loan';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { ManualAsset } from '@entity/ManualAsset';
import { ManualAssetValuation } from '@entity/ManualAssetValuation';
import { RecurringOccurrence } from '@entity/RecurringOccurrence';
import { RecurringSeries } from '@entity/RecurringSeries';
import type { Tenant } from '@entity/Tenant';
import { Transaction } from '@entity/Transaction';
import { Watchlist } from '@entity/Watchlist';
import { LoanAllocationSource } from '@service/loan/loan-types';
import { ManualAssetKind } from '@service/manual-asset/manual-asset-types';
import { RecurringSeriesSource, RecurringSeriesStatus, RecurringSeriesType } from '@service/recurring/recurring-types';
import { normalizeRecurringMerchant } from '@service/recurring/recurring-detection.utils';
import { Recurrency } from '@utils/budget';

import { demoBudget } from './demo-budget';
import { demoAccounts } from './demo-fixtures';
import { demoLoans } from './demo-loans';
import { demoTransactionPatterns } from './demo-transactions';

/** Shared by the development seed and the daily refresh. Only the demo household is passed in.
 * Match fixture names/relations so reruns repair examples without accumulating duplicate rows.
 * Dates derived from transactions move with the daily refresh; valuation dates remain fixed.
 */
export async function upsertDemoFeatures(
  em: EntityManager,
  appuser: Appuser,
  tenant: Tenant,
  asOfDate: Date,
): Promise<void> {
  const currency = appuser.currencyKey;
  const budget = await em.findOneOrFail(Budget, { appuserKey: appuser, name: demoBudget.name, tenantKey: tenant });
  await upsert(
    em,
    BudgetTemplateIncome,
    { budgetKey: budget, name: 'Salary from ACME' },
    {
      amount: 2000,
      budgetKey: budget,
      name: 'Salary from ACME',
      recurrency: Recurrency.MONTHLY,
    },
  );

  const transactions = await em.find(
    Transaction,
    { appuserKey: appuser, tenantKey: tenant },
    {
      orderBy: { transactionDate: 'asc' },
      populate: ['transactionMerchantKey', 'settlementCurrencyKey'],
    },
  );
  for (const transaction of transactions) {
    const pattern = demoTransactionPatterns.find((candidate) => candidate.description === transaction.description);
    if (!pattern) continue;
    const category = await em.findOneOrFail(Category, { isSystemCategory: true, name: pattern.category });
    await upsert(
      em,
      AppuserTransactionCategory,
      { appuserKey: appuser, transactionKey: transaction },
      {
        appuserKey: appuser,
        categoryKey: category,
        source: Source.USER,
        transactionKey: transaction,
      },
    );
    if (transaction.transactionMerchantKey) {
      await upsert(
        em,
        AppuserMerchantCategory,
        { appuserKey: appuser, transactionMerchantKey: transaction.transactionMerchantKey },
        {
          appuserKey: appuser,
          categoryKey: category,
          source: MerchantCategorySource.USER,
          transactionMerchantKey: transaction.transactionMerchantKey,
        },
      );
    }
    transaction.processed = true;
    transaction.reviewed = true;
  }

  const savings = await em.findOneOrFail(Account, {
    accountId: demoAccounts.savings.accountId,
    accountOwnerAppuserKey: appuser,
    tenantKey: tenant,
  });
  const goal = await upsert(
    em,
    Goal,
    { appuserKey: appuser, name: 'Emergency fund', tenantKey: tenant },
    {
      appuserKey: appuser,
      currencyKey: currency,
      description: 'Build a buffer for unexpected household expenses.',
      monthlyContributionTarget: 500,
      name: 'Emergency fund',
      priority: 0,
      targetAmount: 6000,
      targetDate: addMonths(asOfDate, 6),
      tenantKey: tenant,
      type: GoalType.SAVE_UP,
    },
  );
  await upsert(
    em,
    GoalAccountLink,
    { accountKey: savings, goalKey: goal, tenantKey: tenant },
    {
      accountKey: savings,
      goalKey: goal,
      tenantKey: tenant,
    },
  );

  for (const fixture of [
    { kind: ManualAssetKind.PROPERTY, name: 'Family home', purchasePrice: 185_000, value: 225_000 },
    { kind: ManualAssetKind.VEHICLE, name: 'Family car', purchasePrice: 18_000, value: 12_500 },
  ]) {
    const asset = await upsert(
      em,
      ManualAsset,
      { name: fixture.name, ownerAppuserKey: appuser, tenantKey: tenant },
      {
        currencyKey: currency,
        kind: fixture.kind,
        name: fixture.name,
        ownerAppuserKey: appuser,
        purchaseDate: new Date('2024-01-01T00:00:00.000Z'),
        purchasePrice: fixture.purchasePrice,
        tenantKey: tenant,
      },
    );
    for (const valuation of [
      { valuationDate: new Date('2024-01-01T00:00:00.000Z'), value: fixture.purchasePrice },
      { valuationDate: new Date('2026-01-01T00:00:00.000Z'), value: fixture.value },
    ]) {
      await upsert(
        em,
        ManualAssetValuation,
        { manualAssetKey: asset, tenantKey: tenant, valuationDate: valuation.valuationDate },
        {
          ...valuation,
          manualAssetKey: asset,
          tenantKey: tenant,
        },
      );
    }
  }

  for (const fixture of [
    { name: 'Netflix', type: RecurringSeriesType.subscription },
    { name: 'EDP Comercial', type: RecurringSeriesType.bill },
    { name: 'MEO', type: RecurringSeriesType.bill },
  ]) {
    const matches = transactions.filter(
      (transaction) => transaction.description === fixture.name && transaction.transactionDate,
    );
    const first = matches.at(0);
    const last = matches.at(-1);
    if (!first?.transactionDate || !last?.transactionDate) continue;
    let nextExpectedAt = addMonths(last.transactionDate, 1);
    while (nextExpectedAt <= asOfDate) nextExpectedAt = addMonths(nextExpectedAt, 1);
    const normalizedMerchantKey = normalizeRecurringMerchant(fixture.name);
    const series = await upsert(
      em,
      RecurringSeries,
      { displayName: fixture.name, tenantKey: tenant },
      {
        accountKey: last.accountKey,
        appuserKey: appuser,
        currencyKey: last.settlementCurrencyKey,
        displayName: fixture.name,
        expectedAmount: Math.abs(last.settlementAmount ?? 0),
        firstSeenAt: first.transactionDate,
        lastAmount: Math.abs(last.settlementAmount ?? 0),
        lastSeenAt: last.transactionDate,
        merchantDisplayName: fixture.name,
        nextExpectedAt,
        normalizedMerchantKey,
        occurrenceCount: matches.length,
        source: RecurringSeriesSource.user_created,
        status: RecurringSeriesStatus.confirmed,
        tenantKey: tenant,
        type: fixture.type,
      },
    );
    for (const transaction of matches) {
      await upsert(
        em,
        RecurringOccurrence,
        { recurringSeriesKey: series, transactionKey: transaction },
        {
          amount: Math.abs(transaction.settlementAmount ?? 0),
          currencyKey: transaction.settlementCurrencyKey,
          occurrenceDate: transaction.transactionDate!,
          recurringSeriesKey: series,
          transactionKey: transaction,
        },
      );
    }
  }

  const mortgage = await em.findOneOrFail(Loan, {
    name: demoLoans.mortgage.name,
    ownerAppuserKey: appuser,
    tenantKey: tenant,
  });
  for (const transaction of transactions.filter(
    (transaction) =>
      transaction.description === 'Pag Empréstimo Hipoteca' &&
      transaction.transactionDate &&
      transaction.settlementAmount === -600,
  )) {
    await upsert(
      em,
      LoanRepaymentLink,
      { loanKey: mortgage, tenantKey: tenant, transactionKey: transaction },
      {
        allocationSource: LoanAllocationSource.MANUAL,
        feeAmount: 0,
        interestAmount: 280,
        linkedByAppuserKey: appuser,
        loanKey: mortgage,
        needsReview: false,
        paymentDate: transaction.transactionDate!,
        principalAmount: 320,
        tenantKey: tenant,
        totalPaymentAmount: 600,
        transactionKey: transaction,
      },
    );
  }
  // The opening statement must precede the rolling demo repayment dates.
  mortgage.openingBalanceDate = subMonths(asOfDate, 4);

  for (const symbol of ['AAPL.US', 'NVDA.US', 'GOOGL.US']) {
    await upsert(
      em,
      Watchlist,
      { appuserKey: appuser, symbol, tenantKey: tenant },
      { appuserKey: appuser, symbol, tenantKey: tenant },
    );
  }
  const accounts = await em.find(Account, { accountOwnerAppuserKey: appuser, tenantKey: tenant });
  for (const account of accounts) {
    account.refreshedAt = asOfDate;
    account.transactionsRefreshedAt = asOfDate;
  }
}

async function upsert<T extends object>(
  em: EntityManager,
  entity: EntityName<T>,
  criteria: FilterQuery<NoInfer<T>>,
  data: EntityData<NoInfer<T>>,
): Promise<T> {
  const existing = await em.findOne<T>(entity, criteria);
  if (existing) {
    Object.assign(existing, data);
    return existing;
  }
  return em.create(entity, data, { partial: true });
}
