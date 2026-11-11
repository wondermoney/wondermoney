import { createHash } from 'node:crypto';

import Big from 'big.js';
import { formatInTimeZone } from 'date-fns-tz';

import { floorMoney, money } from '@service/budget/aggregation-classifier';
import type { CategorizedTransaction } from '@service/budget/aggregation-classifier';
import { availableForAllocation, spendForAllocation } from '@service/budget/budget-spending-projection';
import { uniqueAllocations } from '@service/budget/tenant-budget-eligibility';

import { INSIGHTS } from './insights.constants';
import type {
  BudgetPaceFacts,
  BudgetPaceInput,
  Insight,
  InsightPeriod,
  InsightSeverity,
  InsightType,
  SpendingVsNormalFacts,
  SpendingVsNormalInput,
} from './insights.types';

const LISBON_TIME_ZONE = 'Europe/Lisbon';

interface CategoryTotal {
  amount: Big;
  leafKeys: Set<number>;
  name: string;
  /** The category's parent, for a leaf row; null for a top-level row. */
  parentKey: null | number;
}

/** Whether a comparison groups transactions by their top-level category or by their leaf. */
export type SpendingComparisonLevel = 'leaf' | 'top';

/**
 * One category's spend this period and the same days of the previous months, before any
 * threshold is applied. `baselineAmount` is the average across the baseline months (a month with
 * nothing in the category contributes zero), so it is the figure the insight facts carry.
 */
export interface SpendingComparison {
  baselineAmount: Big;
  categoryKey: number;
  currentAmount: Big;
  /** The leaf categories the current spend landed in (empty when nothing was spent). */
  leafKeys: number[];
  name: string;
  parentKey: null | number;
}

/**
 * A stable id for an insight: the same type, subject and period always hash to the same string, so
 * a client can key a dismissed card (later) or diff a list without the server persisting anything.
 */
export function insightId(type: InsightType, subject: string, period: InsightPeriod): string {
  return createHash('sha256').update(`${type}:${subject}:${period}`).digest('hex').slice(0, 16);
}

export function periodKey(month: number, year: number): InsightPeriod {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Spending against the same days of the previous three full months, one card per top-level
 * category. Fires only once a baseline exists and the deviation is material.
 */
export function spendingVsNormalInsights(input: SpendingVsNormalInput): Insight[] {
  const { baselineComplete, baselineMonths, currency, daysElapsed, fromDate, month, toDate, year } = input;
  if (!baselineComplete) return [];
  if (daysElapsed < INSIGHTS.MIN_DAYS_ELAPSED) return [];
  if (baselineMonths.length < INSIGHTS.SPENDING_VS_NORMAL.BASELINE_MONTHS) return [];

  const period = periodKey(month, year);
  const candidates: { deviation: Big; insight: Extract<Insight, { type: 'spending_vs_normal' }> }[] = [];

  for (const comparison of compareSpendingToNormal(input, 'top')) {
    // A category with nothing spent so far is not "running hot"; a drop to zero is not news.
    if (comparison.currentAmount.lte(0)) continue;
    if (comparison.baselineAmount.lt(INSIGHTS.SPENDING_VS_NORMAL.MIN_BASELINE_AMOUNT)) continue;

    const deviation = comparison.currentAmount.minus(comparison.baselineAmount).div(comparison.baselineAmount).times(100);
    if (deviation.abs().lt(INSIGHTS.SPENDING_VS_NORMAL.DEVIATION_PERCENT)) continue;

    const direction = deviation.gt(0) ? 'above' : 'below';
    const facts: SpendingVsNormalFacts = {
      baselineAmount: money(comparison.baselineAmount),
      categoryKey: comparison.categoryKey,
      categoryKeys: comparison.leafKeys,
      categoryName: comparison.name,
      currency,
      currentAmount: money(comparison.currentAmount),
      daysElapsed,
      deviationPercent: deviation.toFixed(2),
      direction,
      fromDate,
      toDate,
    };
    candidates.push({
      deviation: deviation.abs(),
      insight: {
        facts,
        id: insightId('spending_vs_normal', `category:${comparison.categoryKey}`, period),
        period,
        severity: direction === 'above' ? 'warning' : 'info',
        type: 'spending_vs_normal',
      },
    });
  }

  return candidates
    .sort(
      (left, right) =>
        right.deviation.cmp(left.deviation) ||
        left.insight.facts.categoryKey - right.insight.facts.categoryKey,
    )
    .slice(0, INSIGHTS.SPENDING_VS_NORMAL.MAX_INSIGHTS)
    .map((candidate) => candidate.insight);
}

/**
 * Per-category spend this period against the same days of each baseline month, without the
 * insight thresholds: the one arithmetic behind both the home insight and the
 * spending-vs-normal report, so the two can never disagree.
 *
 * `top` groups by the top-level category (`parentCategoryKey ?? categoryKey`), the unit the
 * insight card reports. `leaf` groups by the category the transaction was actually assigned to,
 * which is what the report's subcategory rows need. Both floor a category at zero, so a refund
 * nets against the category it lands in and never reads as negative spend.
 */
export function compareSpendingToNormal(input: SpendingVsNormalInput, level: SpendingComparisonLevel): SpendingComparison[] {
  const { baselineMonths, currentTransactions, daysElapsed, timeZone } = input;
  const group = level === 'leaf' ? totalsByLeafCategory : totalsByTopLevelCategory;
  const current = group(currentTransactions);
  const baselines = baselineMonths.map((baseline) =>
    group(baseline.transactions.filter((transaction) => dayOfMonth(transaction.transactionDate, timeZone) <= daysElapsed)),
  );

  const categoryKeys = new Set<number>([...current.keys(), ...baselines.flatMap((totals) => [...totals.keys()])]);
  return [...categoryKeys].sort((left, right) => left - right).map((categoryKey) => {
    const currentTotal = current.get(categoryKey);
    const baselineTotal = baselines.map((totals) => totals.get(categoryKey)).find((total) => total !== undefined);
    return {
      baselineAmount: average(baselines.map((totals) => totals.get(categoryKey)?.amount ?? new Big(0))),
      categoryKey,
      currentAmount: currentTotal?.amount ?? new Big(0),
      leafKeys: [...(currentTotal?.leafKeys ?? [])].sort((left, right) => left - right),
      name: currentTotal?.name ?? baselineTotal?.name ?? '',
      parentKey: currentTotal?.parentKey ?? baselineTotal?.parentKey ?? null,
    };
  });
}

/**
 * Budget pace: spend so far scaled to the whole month, against what the allocation may spend.
 * Fires when the projection overruns the allocation.
 */
export function budgetPaceInsights(input: BudgetPaceInput): Insight[] {
  const { allocations, currentTransactions, daysElapsed, daysInMonth, month, year } = input;
  if (daysElapsed < INSIGHTS.MIN_DAYS_ELAPSED || daysInMonth <= 0) return [];

  const elapsedFraction = new Big(daysElapsed).div(daysInMonth);
  const period = periodKey(month, year);
  const insights: Insight[] = [];

  for (const allocation of uniqueAllocations(allocations)) {
    const spent = spendForAllocation(allocation, currentTransactions, allocations);
    if (spent.lte(0)) continue;

    const available = availableForAllocation(allocation);
    const projected = spent.div(elapsedFraction);
    if (!projected.gt(available)) continue;

    const budgeted = available.lt(0) ? new Big(0) : available;
    const facts: BudgetPaceFacts = {
      amountBudgeted: money(budgeted),
      amountSpent: money(spent),
      budgetKey: allocation.budgetKey,
      budgetName: allocation.budgetName,
      budgetTemplateCategoryKey: allocation.budgetTemplateCategoryKey,
      categoryKey: allocation.categoryKey,
      categoryName: allocation.categoryName,
      currencyCode: allocation.currencyCode,
      daysElapsed,
      daysInMonth,
      elapsedPercent: elapsedFraction.times(100).toFixed(2),
      overBy: money(projected.minus(budgeted)),
      parentCategoryName: allocation.parentCategoryName,
      projectedAmount: money(projected),
    };
    insights.push({
      facts,
      id: insightId('budget_pace', `budget:${allocation.budgetTemplateCategoryKey}`, period),
      period,
      severity: spent.gte(available) ? 'critical' : 'warning',
      type: 'budget_pace',
    });
  }

  return insights.sort((left, right) => left.id.localeCompare(right.id));
}

export function generateInsights(input: { budget: BudgetPaceInput; spending: SpendingVsNormalInput }): Insight[] {
  return [...budgetPaceInsights(input.budget), ...spendingVsNormalInsights(input.spending)].sort(
    (left, right) => severityRank(left.severity) - severityRank(right.severity) || left.id.localeCompare(right.id),
  );
}

function average(values: readonly Big[]): Big {
  if (values.length === 0) return new Big(0);
  return values.reduce((sum, value) => sum.plus(value), new Big(0)).div(values.length);
}

function dayOfMonth(date: Date, timeZone: string = LISBON_TIME_ZONE): number {
  return Number(formatInTimeZone(date, timeZone, 'd'));
}

function severityRank(severity: InsightSeverity): number {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

/**
 * Net spend per top-level (parent) category. A refund nets against the category it lands in, and a
 * category never goes below zero, the same rule `classifyTransactions` and the monthly email use.
 */
function totalsByTopLevelCategory(transactions: readonly CategorizedTransaction[]): Map<number, CategoryTotal> {
  return totalsBy(transactions, (transaction) => ({
    key: transaction.parentCategoryKey ?? transaction.categoryKey,
    name: transaction.parentCategoryName ?? transaction.categoryName,
    parentKey: null,
  }));
}

/** Net spend per group, floored at zero, with the leaf categories the group's spend landed in. */
function totalsBy(
  transactions: readonly CategorizedTransaction[],
  group: (transaction: CategorizedTransaction) => { key: number; name: string; parentKey: null | number },
): Map<number, CategoryTotal> {
  const raw = new Map<number, CategoryTotal>();
  for (const transaction of transactions) {
    const { key, name, parentKey } = group(transaction);
    const current = raw.get(key) ?? { amount: new Big(0), leafKeys: new Set<number>(), name, parentKey };
    current.amount = current.amount.plus(transaction.amount);
    current.leafKeys.add(transaction.categoryKey);
    raw.set(key, current);
  }
  const totals = new Map<number, CategoryTotal>();
  for (const [key, value] of raw) {
    totals.set(key, { amount: floorMoney(value.amount), leafKeys: value.leafKeys, name: value.name, parentKey: value.parentKey });
  }
  return totals;
}

/** Net spend per assigned (leaf) category, with the top-level category it belongs to. */
function totalsByLeafCategory(transactions: readonly CategorizedTransaction[]): Map<number, CategoryTotal> {
  return totalsBy(transactions, (transaction) => ({
    key: transaction.categoryKey,
    name: transaction.categoryName,
    parentKey: transaction.parentCategoryKey,
  }));
}
