import Big from 'big.js';

import { savingsRatePercent } from '@utils/savings-rate';

import {
  classifyBudgetThreshold,
  classifyTransactions,
  createDiagnostics,
  floorMoney,
  money,
} from './aggregation-classifier';
import { getLisbonBudgetPeriod, getLisbonWeeklyPeriod } from './aggregation-periods';
import type { InstantRange, LisbonBudgetPeriod } from './aggregation-periods';
import type {
  AggregationSuppressedResult,
  BudgetAggregationResult,
  BudgetAllocationRow,
  BudgetRemainingResult,
  MonthlyAggregationResult,
  MonthlyStoryAggregationResult,
  MonthlyStoryCategoryDelta,
  MonthlyStoryInsufficientResult,
  TenantAggregationInput,
  TenantAggregationRepository,
  WeeklyAggregationResult,
} from './aggregation-types';
import { availableForAllocation, buildBudgetPressure, classifyAvailableThreshold, spendForAllocation } from './budget-spending-projection';
import { MikroOrmTenantAggregationRepository } from './tenant-aggregation.repository';
import { partitionByEligibility, uniqueAllocations } from './tenant-budget-eligibility';

export class TenantFinancialAggregationService {
  constructor(private readonly repository: TenantAggregationRepository = new MikroOrmTenantAggregationRepository()) {}

  async aggregateBudgetThresholds(input: TenantAggregationInput): Promise<AggregationSuppressedResult | BudgetAggregationResult> {
    const period = getLisbonBudgetPeriod(input.scheduledFor);
    const diagnostics = createDiagnostics();
    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'inactive_membership', status: 'suppressed', tenantKey: input.tenantKey };
    }

    // Each budget in the budget month today is in, measured over that month's days so far.
    const allocationRows = await this.repository.loadBudgetAllocations(input.appuserKey, { day: localDay(period) });
    const allocations = partitionByEligibility(allocationRows, { appuserKey: input.appuserKey, tenantKey: input.tenantKey });
    const transactionRows = await this.repository.loadTransactions(input.appuserKey, input.tenantKey, until(covering(allocations.rows.map((row) => row.period), period.monthRange), period.scheduledFor));
    const transactions = classifyTransactions(transactionRows, input.appuserKey, input.tenantKey, diagnostics);
    const facts = allocations.rows.flatMap((allocation) => {
      const spent = spendForAllocation(allocation, transactions, allocations.rows);
      // Measured against what the month may spend, rollover included. With nothing available
      // there is no percentage to put in an alert; the budget badge still shows it over.
      const budgeted = availableForAllocation(allocation);
      if (budgeted.lte(0)) return [];
      const threshold = classifyBudgetThreshold(spent, budgeted);
      if (!threshold) return [];
      return [{
        actualPercentage: spent.times(100).div(budgeted).toFixed(2),
        amountBudgeted: money(budgeted),
        amountSpent: money(spent),
        budgetKey: allocation.budgetKey,
        budgetName: allocation.budgetName,
        budgetTemplateCategoryKey: allocation.budgetTemplateCategoryKey,
        categoryKey: allocation.categoryKey,
        categoryName: allocation.categoryName,
        claimThresholds: threshold.claimThresholds,
        currencyCode: allocation.currencyCode,
        month: allocation.month,
        parentCategoryName: allocation.parentCategoryName,
        remainingOrOverAmount: money(threshold.state === 'over' ? spent.minus(budgeted) : budgeted.minus(spent)),
        state: threshold.state,
        threshold: threshold.threshold,
        year: allocation.year,
      }];
    });

    return { appuserKey: input.appuserKey, diagnostics, facts: uniqueFacts(facts), period, status: 'ok', suppressedBudgets: allocations.suppressedBudgets, tenantKey: input.tenantKey };
  }

  /** Total remaining budget headroom this month, summed across all validated allocations (not just those crossing a threshold). */
  async aggregateBudgetRemaining(input: TenantAggregationInput): Promise<AggregationSuppressedResult | BudgetRemainingResult> {
    const period = getLisbonBudgetPeriod(input.scheduledFor);
    const diagnostics = createDiagnostics();
    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'inactive_membership', status: 'suppressed', tenantKey: input.tenantKey };
    }

    const allocationRows = await this.repository.loadBudgetAllocations(input.appuserKey, { day: localDay(period) });
    const allocations = partitionByEligibility(allocationRows, { appuserKey: input.appuserKey, tenantKey: input.tenantKey });
    if (allocations.rows.length === 0) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'no_useful_sections', status: 'suppressed', tenantKey: input.tenantKey };
    }

    const rows = await this.repository.loadTransactions(input.appuserKey, input.tenantKey, covering(allocations.rows.map((row) => row.period), period.monthRange));
    const transactions = classifyTransactions(rows, input.appuserKey, input.tenantKey, diagnostics);
    let totalBudgeted = new Big(0);
    let totalSpent = new Big(0);
    for (const allocation of uniqueAllocations(allocations.rows)) {
      const spent = spendForAllocation(allocation, transactions, allocations.rows);
      totalBudgeted = totalBudgeted.plus(availableForAllocation(allocation));
      totalSpent = totalSpent.plus(spent);
    }
    const remaining = totalBudgeted.minus(totalSpent);

    return {
      appuserKey: input.appuserKey,
      diagnostics,
      facts: {
        remaining: money(remaining.lt(0) ? new Big(0) : remaining),
        spent: money(floorMoney(totalSpent)),
        totalBudgeted: money(floorMoney(totalBudgeted)),
      },
      period,
      status: 'ok',
      tenantKey: input.tenantKey,
    };
  }

  /** Whole-month total spend + top category, the monthly analog of `aggregateWeeklyInsights`'s subject-week facts. */
  async aggregateMonthlyInsights(input: TenantAggregationInput): Promise<AggregationSuppressedResult | MonthlyAggregationResult> {
    const period = getLisbonBudgetPeriod(input.scheduledFor);
    const diagnostics = createDiagnostics();
    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'inactive_membership', status: 'suppressed', tenantKey: input.tenantKey };
    }

    const rows = await this.repository.loadTransactions(input.appuserKey, input.tenantKey, period.monthRange);
    const transactions = classifyTransactions(rows, input.appuserKey, input.tenantKey, diagnostics);
    if (transactions.length === 0) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'no_uniquely_categorized_transactions', status: 'suppressed', tenantKey: input.tenantKey };
    }

    const monthTotal = floorMoney(transactions.reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0)));
    const topCategory = topCategoryFor(transactions);

    return {
      appuserKey: input.appuserKey,
      diagnostics,
      facts: { monthTotal: money(monthTotal), topCategory },
      period,
      status: 'ok',
      tenantKey: input.tenantKey,
    };
  }

  /**
   * Monthly Money Story: income/spending vs. a 3-month trailing average,
   * category deltas ranked by absolute € delta, savings rate. Net worth and recurring
   * changes are NOT computed here — net worth needs the appuser-scoped NetWorthService
   * (fetched by the caller, see FinancialEmailUserWorkerService) and recurring changes
   * are computed by a separate helper (Task 12) since they query RecurringSeries/
   * RecurringOccurrence directly rather than TransactionAggregationRow.
   */
  async aggregateMonthlyStory(
    input: TenantAggregationInput,
  ): Promise<MonthlyStoryAggregationResult | MonthlyStoryInsufficientResult> {
    // The monthly cron fires on the 1st at 9am, so `getLisbonBudgetPeriod(scheduledFor)` is the
    // month that just STARTED (the trigger month), not the just-closed month the email narrates.
    // Mirror getLisbonWeeklyPeriod's "current period minus one full period = the just-closed
    // period" convention: subject = one month before the trigger month, baselines = the 3 months
    // before the subject (i.e. 2/3/4 months before the trigger month).
    const currentPeriod = getLisbonBudgetPeriod(input.scheduledFor);
    const subjectPeriod = this.priorMonthPeriod(currentPeriod, 1);
    const baselinePeriods = [2, 3, 4].map((monthsBack) => this.priorMonthPeriod(currentPeriod, monthsBack));

    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) {
      return {
        appuserKey: input.appuserKey,
        monthsAvailable: 0,
        monthsNeeded: 3,
        period: subjectPeriod,
        reason: 'insufficient_history',
        status: 'insufficient_data',
        tenantKey: input.tenantKey,
      };
    }

    const [subjectRows, ...baselineRowSets] = await Promise.all([
      this.repository.loadTransactions(input.appuserKey, input.tenantKey, subjectPeriod.monthRange),
      ...baselinePeriods.map((period) => this.repository.loadTransactions(input.appuserKey, input.tenantKey, period.monthRange)),
    ]);

    const monthsAvailable = baselineRowSets.filter((rows) => rows.length > 0).length;
    if (monthsAvailable < 3) {
      return {
        appuserKey: input.appuserKey,
        monthsAvailable,
        monthsNeeded: 3,
        period: subjectPeriod,
        reason: 'insufficient_history',
        status: 'insufficient_data',
        tenantKey: input.tenantKey,
      };
    }

    const diagnostics = createDiagnostics();
    const subjectTransactions = classifyTransactions(subjectRows, input.appuserKey, input.tenantKey, diagnostics);
    if (subjectTransactions.length === 0) {
      return {
        appuserKey: input.appuserKey,
        monthsAvailable,
        monthsNeeded: 3,
        period: subjectPeriod,
        reason: 'zero_activity',
        status: 'insufficient_data',
        tenantKey: input.tenantKey,
      };
    }
    const baselineTransactionSets = baselineRowSets.map((rows) =>
      classifyTransactions(rows, input.appuserKey, input.tenantKey, diagnostics),
    );

    const monthTotals = (transactions: ReturnType<typeof classifyTransactions>) => {
      const income = floorMoney(
        transactions
          .filter((transaction) => transaction.amount.lt(0))
          .reduce((sum, transaction) => sum.plus(transaction.amount.neg()), new Big(0)),
      );
      const spending = floorMoney(
        transactions
          .filter((transaction) => transaction.amount.gt(0))
          .reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0)),
      );
      const byCategory = new Map<number, { amount: Big; displayName: string }>();
      for (const transaction of transactions.filter((transaction) => transaction.amount.gt(0))) {
        const current = byCategory.get(transaction.categoryKey);
        byCategory.set(transaction.categoryKey, {
          amount: (current?.amount ?? new Big(0)).plus(transaction.amount),
          displayName: current?.displayName ?? transaction.categoryName,
        });
      }
      return { byCategory, income, spending };
    };

    const subjectTotals = monthTotals(subjectTransactions);
    const baselineTotalsSets = baselineTransactionSets.map(monthTotals);
    const average = (values: Big[]) => values.reduce((sum, value) => sum.plus(value), new Big(0)).div(values.length || 1);
    const incomeBaseline = average(baselineTotalsSets.map((totals) => totals.income));
    const spendingBaseline = average(baselineTotalsSets.map((totals) => totals.spending));

    const allCategoryKeys = new Set([
      ...subjectTotals.byCategory.keys(),
      ...baselineTotalsSets.flatMap((totals) => [...totals.byCategory.keys()]),
    ]);
    const categoryDeltas: MonthlyStoryCategoryDelta[] = [...allCategoryKeys]
      .map((categoryKey) => {
        const subjectAmount = subjectTotals.byCategory.get(categoryKey)?.amount ?? new Big(0);
        const baselineAmount = average(
          baselineTotalsSets.map((totals) => totals.byCategory.get(categoryKey)?.amount ?? new Big(0)),
        );
        const displayName =
          subjectTotals.byCategory.get(categoryKey)?.displayName ??
          baselineTotalsSets.find((totals) => totals.byCategory.has(categoryKey))?.byCategory.get(categoryKey)?.displayName ??
          '';
        return {
          baselineAmount: money(baselineAmount),
          categoryKey,
          direction: subjectAmount.gte(baselineAmount) ? ('increase' as const) : ('decrease' as const),
          displayName,
          percentOfBaseline: baselineAmount.gt(0)
            ? subjectAmount.minus(baselineAmount).div(baselineAmount).times(100).toFixed(2)
            : null,
          subjectAmount: money(subjectAmount),
        };
      })
      .sort(
        (left, right) =>
          Number(new Big(right.subjectAmount).minus(right.baselineAmount).abs()) -
          Number(new Big(left.subjectAmount).minus(left.baselineAmount).abs()),
      );

    // The same helper the cash-flow report uses, so the email and the dashboard
    // state the same rate for the same month.
    const savingsRateSubject = savingsRatePercent(subjectTotals.income, subjectTotals.spending);
    const savingsRateBaseline = savingsRatePercent(incomeBaseline, spendingBaseline);

    const budgetPressure = await this.monthlyBudgetPressure(
      input.appuserKey,
      input.tenantKey,
      subjectPeriod.month,
      subjectPeriod.year,
    );

    return {
      appuserKey: input.appuserKey,
      diagnostics,
      facts: {
        budgetPressure,
        categoryDeltas,
        incomeBaseline: money(incomeBaseline),
        incomeSubject: money(subjectTotals.income),
        recurringChanges: [],
        savingsRateBaseline,
        savingsRateSubject,
        spendingBaseline: money(spendingBaseline),
        spendingSubject: money(subjectTotals.spending),
      },
      period: subjectPeriod,
      status: 'ok',
      tenantKey: input.tenantKey,
    };
  }

  private priorMonthPeriod(fromPeriod: LisbonBudgetPeriod, monthsBack: number): LisbonBudgetPeriod {
    const [year, month] = fromPeriod.localDate.split('-').map(Number) as [number, number];
    const isoInstant = new Date(Date.UTC(year, month - 1 - monthsBack, 15, 12)).toISOString();
    return getLisbonBudgetPeriod(isoInstant);
  }

  /**
   * Reuses the same loadBudgetAllocations + classifyBudgetThreshold pair
   * aggregateBudgetThresholds already uses, and the same over > near > within_plan
   * severity-picking convention combineWeeklyResults already uses for
   * activeBudgetStatus — so a single over-budget category is enough to report 'over'
   * for the whole month, matching existing behavior exactly rather than inventing a
   * new severity rule.
   */
  async aggregateWeeklyInsights(input: TenantAggregationInput): Promise<AggregationSuppressedResult | WeeklyAggregationResult> {
    const period = getLisbonWeeklyPeriod(input.scheduledFor);
    const diagnostics = createDiagnostics();
    if (!(await this.repository.hasActiveMembership(input.appuserKey, input.tenantKey))) {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'inactive_membership', status: 'suppressed', tenantKey: input.tenantKey };
    }

    // The active budget badge reads each budget's current budget month, over that month's days.
    const allocationRows = await this.repository.loadBudgetAllocations(input.appuserKey, { day: localDay(getLisbonBudgetPeriod(input.scheduledFor)) });
    const allocations = partitionByEligibility(allocationRows, { appuserKey: input.appuserKey, tenantKey: input.tenantKey });
    const transactionRange = until(covering([...allocations.rows.map((row) => row.period), period.comparisonWeek, period.subjectWeek], period.monthRange), period.scheduledFor);
    const rows = await this.repository.loadTransactions(input.appuserKey, input.tenantKey, transactionRange);
    const transactions = classifyTransactions(rows, input.appuserKey, input.tenantKey, diagnostics);
    const subject = transactions.filter((transaction) => inRange(transaction.transactionDate, period.subjectWeek));
    const comparison = transactions.filter((transaction) => inRange(transaction.transactionDate, period.comparisonWeek));

    const subjectSignedTotal = subject.reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0));
    const subjectTotal = floorMoney(subjectSignedTotal);
    const comparisonSignedTotal = comparison.reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0));
    const comparisonTotal = floorMoney(comparison.reduce((sum, transaction) => sum.plus(transaction.amount), new Big(0)));
    const topCategory = subject.length ? topCategoryFor(subject) : { amount: '0', categoryKey: 0, displayName: '' };
    const activeStatus = activeBudgetStatus(allocations.rows, transactions);
    const comparisonAvailable = comparison.length > 0 && comparisonTotal.gt(0);
    const weeklyComponents = { activeBudgetStatus: activeStatus, categoryTotals: signedCategoryTotalsFor(subject), comparisonSignedTotal: comparisonAvailable ? money(comparisonSignedTotal) : null, hasSubjectTransactions: subject.length > 0, subjectSignedTotal: money(subjectSignedTotal) };
    if (subject.length === 0) return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'no_uniquely_categorized_transactions', status: 'suppressed', tenantKey: input.tenantKey, weeklyComponents };
    if (subjectTotal.eq(0) && topCategory.amount === '0') {
      return { appuserKey: input.appuserKey, diagnostics, facts: [], period, reason: 'no_useful_sections', status: 'suppressed', tenantKey: input.tenantKey, weeklyComponents };
    }

    return {
      appuserKey: input.appuserKey,
      diagnostics,
      facts: {
        activeBudgetStatus: activeStatus,
        categoryTotals: categoryTotalsFor(subject),
        comparisonPercentage: comparisonAvailable
          ? subjectTotal.minus(comparisonTotal).times(100).div(comparisonTotal).toFixed(2)
          : null,
        comparisonWeekTotal: comparisonAvailable ? money(comparisonTotal) : null,
        isoWeek: period.isoWeek,
        isoWeekYear: period.isoWeekYear,
        subjectWeekTotal: money(subjectTotal),
        topCategory,
      },
      period,
      status: 'ok',
      suppressedBudgets: allocations.suppressedBudgets,
      tenantKey: input.tenantKey,
      weeklyComponents,
    };
  }

  private async monthlyBudgetPressure(
    appuserKey: number,
    tenantKey: number,
    month: number,
    year: number,
  ): Promise<'near' | 'over' | 'within_plan' | null> {
    // The budget month named like the month the story narrates, over the days its start day gives it.
    const allocations = await this.repository.loadBudgetAllocations(appuserKey, { month, year });
    const validAllocations = allocations.filter(
      (allocation) =>
        allocation.accountKey != null &&
        !allocation.accountClosed &&
        !allocation.accountDeleted &&
        allocation.accountTenantKey === tenantKey &&
        allocation.accountOwnerAppuserKey === appuserKey &&
        new Big(allocation.amountBudgeted).gt(0),
    );
    if (validAllocations.length === 0) return null;
    const rows = await this.repository.loadTransactions(appuserKey, tenantKey, covering(validAllocations.map((allocation) => allocation.period)));
    const diagnostics = createDiagnostics();
    const transactions = classifyTransactions(rows, appuserKey, tenantKey, diagnostics);
    const thresholds = validAllocations.map((allocation) =>
      classifyAvailableThreshold(spendForAllocation(allocation, transactions, allocations), availableForAllocation(allocation)),
    );
    return buildBudgetPressure(thresholds);
  }
}

function activeBudgetStatus(
  allocations: BudgetAllocationRow[],
  transactions: ReturnType<typeof classifyTransactions>,
): 'near' | 'over' | 'within_plan' | null {
  const thresholds = uniqueAllocations(allocations).map((allocation) =>
    classifyAvailableThreshold(spendForAllocation(allocation, transactions, allocations), availableForAllocation(allocation)),
  );
  return buildBudgetPressure(thresholds);
}

function categoryTotalsFor(transactions: ReturnType<typeof classifyTransactions>) {
  const totals = new Map<number, { amount: Big; categoryKey: number; displayName: string }>();
  for (const transaction of transactions) {
    const current = totals.get(transaction.categoryKey);
    const displayName = transaction.parentCategoryName
      ? `${transaction.parentCategoryName} / ${transaction.categoryName}`
      : transaction.categoryName;
    totals.set(transaction.categoryKey, {
      amount: (current?.amount ?? new Big(0)).plus(transaction.amount),
      categoryKey: transaction.categoryKey,
      displayName,
    });
  }
  const sorted = [...totals.values()]
    .map((value) => ({ ...value, amount: floorMoney(value.amount) }))
    .sort((left, right) => right.amount.cmp(left.amount) || left.categoryKey - right.categoryKey);
  return sorted.map((value) => ({ amount: money(value.amount), categoryKey: value.categoryKey, displayName: value.displayName }));
}

/** The smallest range holding every one of `ranges`. */
function covering(ranges: readonly InstantRange[], ...more: InstantRange[]): InstantRange {
  const all = [...ranges, ...more];
  return {
    end: new Date(Math.max(...all.map((range) => range.end.getTime()))),
    start: new Date(Math.min(...all.map((range) => range.start.getTime()))),
  };
}

function inRange(date: Date, range: { end: Date; start: Date }): boolean {
  return date >= range.start && date < range.end;
}

/** UTC midnight of the period's Lisbon calendar day: the day budget months are looked up by. */
function localDay(period: LisbonBudgetPeriod): Date {
  return new Date(`${period.localDate}T00:00:00.000Z`);
}

function signedCategoryTotalsFor(transactions: ReturnType<typeof classifyTransactions>) {
  const totals = new Map<number, { amount: Big; categoryKey: number; displayName: string }>();
  for (const transaction of transactions) {
    const current = totals.get(transaction.categoryKey);
    totals.set(transaction.categoryKey, { amount: (current?.amount ?? new Big(0)).plus(transaction.amount), categoryKey: transaction.categoryKey, displayName: transaction.parentCategoryName ? `${transaction.parentCategoryName} / ${transaction.categoryName}` : transaction.categoryName });
  }
  return [...totals.values()].map((value) => ({ amount: money(value.amount), categoryKey: value.categoryKey, displayName: value.displayName }));
}

function topCategoryFor(transactions: ReturnType<typeof classifyTransactions>) {
  return categoryTotalsFor(transactions)[0]!;
}

function uniqueFacts<T extends { budgetTemplateCategoryKey: number }>(facts: T[]): T[] {
  return [...new Map(facts.map((fact) => [fact.budgetTemplateCategoryKey, fact])).values()];
}

/** `range`, ending no later than `end`. */
function until(range: InstantRange, end: Date): InstantRange {
  return { end: new Date(Math.min(range.end.getTime(), end.getTime())), start: range.start };
}
