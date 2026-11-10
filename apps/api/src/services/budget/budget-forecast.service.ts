import type { EntityManager } from '@mikro-orm/postgresql';

import type { Budget } from '@entity/Budget';
import type { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import type { BudgetTemplateIncome } from '@entity/BudgetTemplateIncome';
import { RecurringSeries } from '@entity/RecurringSeries';
import { expectedOccurrenceAmount, isExpectedRecurring } from '@service/recurring/recurring-expectation';
import { RecurringSeriesStatus } from '@service/recurring/recurring-types';
import { loadDailyRates, type ReportCompleteness } from '@service/reports/report-currency';
import { loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { convertMoney, sumMoney } from '@utils/money';

import { computeForecast, type ForecastMonth, type ForecastMonthInput, type ForecastRowInput, projectOccurrences } from './budget-forecast';
import { monthIndex } from './budget-rollover';
import { getMonthRollover, monthlyPlan, rolloverRowsOf } from './budget-rollover.service';
import { getBudgetSpending } from './spending';

export interface BudgetForecastInput {
  /** With `currencyKey` and every row (`budgetTemplatesCategory`, with its accounts) populated. */
  budget: Budget;
  incomes: BudgetTemplateIncome[];
  /** How many months, the current one first. */
  months: number;
  now: Date;
  tenantKey: number;
  viewerAppuserKey: number;
}

/** One expected date of a recurring item, in the budget's currency. A projection, never spending. */
export interface BudgetForecast {
  /** The UTC day the forecast was made on: spending is actual up to it, projected after. */
  asOf: string;
  /** What the projected figures rest on. */
  basis: {
    /** The budget's planned income, per month. */
    plannedIncome: { amount: number; name: string }[];
    /** The recurring items projected, each occurrence's amount in the budget's currency. */
    recurringItems: { amount: number; cadence: string; categoryKey: number; currencyCode: string; name: string; originalAmount: number; recurringSeriesKey: number }[];
  };
  budgetKey: number;
  completeness: ReportCompleteness & { unconvertedRecurringItems: number };
  currencyCode: string;
  months: (ForecastMonth & { recurring: ForecastOccurrence[] })[];
}

export interface ForecastOccurrence {
  amount: number;
  categoryKey: number;
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  recurringSeriesKey: number;
}

/**
 * A budget's forecast for the current month and the `months - 1` after it.
 *
 * The current month's spending and carried amount are the ones its budget month shows (the same
 * spending query and rollover). Every month adds what the budget's expected recurring items
 * (`recurring-expectation.ts`) will take from today on: an item counts in a month when its category
 * has a row there and its account is one the month counts, and the category counts as spending.
 * An item in another currency is converted at the latest rate known today; with no rate it is left
 * out and the months it falls in are marked incomplete. Income is the budget's planned income.
 *
 * The number of queries does not depend on `months`: rows come from the populated budget, and the
 * spending, rollover, recurring items, flags and rates are each read once.
 */
export async function getBudgetForecast(em: EntityManager, input: BudgetForecastInput): Promise<BudgetForecast> {
  const { budget, tenantKey, viewerAppuserKey } = input;
  const currency = budget.currencyKey;
  const today = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()));
  const asOf = isoDay(today);
  const window = Array.from({ length: input.months }, (_, offset) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
  });
  const current = window[0];
  const last = window.at(-1);
  if (!current || !last) throw new RangeError('A forecast covers at least one month');
  const windowEnd = new Date(Date.UTC(last.year, last.month, 0));

  const allRows = budget.budgetTemplatesCategory.getItems();
  const rowsByMonth = new Map<number, BudgetTemplateCategory[]>();
  for (const row of allRows) {
    const rows = rowsByMonth.get(monthIndex(row)) ?? [];
    rows.push(row);
    rowsByMonth.set(monthIndex(row), rows);
  }
  const accountsOf = (rows: BudgetTemplateCategory[]) => new Set(rows.flatMap((row) => row.accounts.getItems().map((account) => account.accountKey)));
  const windowRows = window.flatMap((month) => rowsByMonth.get(monthIndex(month)) ?? []);
  const currentRows = rowsByMonth.get(monthIndex(current)) ?? [];

  const [spending, rollover, series, flags] = await Promise.all([
    currentRows.length === 0
      ? null
      : getBudgetSpending({
          accountKeys: [...accountsOf(currentRows)],
          currency,
          period: 'monthly',
          templateKeys: currentRows.map((row) => row.budgetTemplateCategoryKey),
          tenantKey,
          viewerAppuserKey,
        }),
    getMonthRollover({ carryOverspend: budget.rolloverCarriesOverspend, currency, month: current.month, rows: rolloverRowsOf(allRows), tenantKey, viewerAppuserKey, year: current.year }),
    windowRows.length === 0 ? [] : loadSeries(em, tenantKey, windowRows, accountsOf(windowRows), windowEnd),
    loadCategorySpendingFlags(em, tenantKey),
  ]);

  // The items that can be projected, on an open account, with an amount.
  const expected = series.flatMap((item) => {
    const { accountKey: account, categoryKey: category, currencyKey: itemCurrency } = item;
    const originalAmount = expectedOccurrenceAmount(item);
    if (!account || account.closed || account.deletedAt != null || !category || originalAmount == null) return [];
    if (!isExpectedRecurring(item) || !flags.countsAsSpending(category)) return [];
    return [{ accountKey: account.accountKey, categoryKey: category.categoryKey, currencyCode: itemCurrency?.code ?? null, item, originalAmount }];
  });
  const rateFor = await loadDailyRates(em, currency.code, expected.flatMap(({ currencyCode }) => (currencyCode ? [{ currencyCode, day: asOf }] : [])));
  // Each valued in the budget's currency at the latest rate: null with no rate (or no currency), never 1.
  const valued = expected.map((entry) => {
    const rate = entry.currencyCode ? rateFor({ currencyCode: entry.currencyCode, day: asOf }) : null;
    return { ...entry, amount: rate == null ? null : convertMoney(entry.originalAmount, rate) };
  });

  const spentByCategory = new Map<number, number>();
  for (const category of spending?.categories ?? []) {
    if (category.child_category_name != null) spentByCategory.set(category.category_key, category.category_amount);
  }
  const spendingComplete = spending?.completeness.isComplete ?? true;

  const used = new Set<number>();
  const unconverted = new Set<number>();
  const occurrencesByMonth: ForecastOccurrence[][] = [];
  const inputs: ForecastMonthInput[] = window.map((month, index) => {
    const rows = rowsByMonth.get(monthIndex(month)) ?? [];
    const accounts = accountsOf(rows);
    const categories = new Set(rows.map((row) => row.categoryKey.categoryKey));
    const monthStart = new Date(Date.UTC(month.year, month.month - 1, 1));
    const monthEnd = new Date(Date.UTC(month.year, month.month, 0));
    const from = monthStart < today ? today : monthStart;

    const projected = new Map<number, number[]>();
    const missing = new Set<number>();
    const occurrences: ForecastOccurrence[] = [];
    for (const { accountKey, amount, categoryKey, item } of valued) {
      if (!categories.has(categoryKey) || !accounts.has(accountKey)) continue;
      const dates = projectOccurrences(item, { from, to: monthEnd });
      if (dates.length === 0) continue;
      if (amount == null) {
        missing.add(categoryKey);
        unconverted.add(item.recurringSeriesKey);
        continue;
      }
      used.add(item.recurringSeriesKey);
      for (const date of dates) {
        projected.set(categoryKey, [...(projected.get(categoryKey) ?? []), amount]);
        occurrences.push({ amount, categoryKey, date: isoDay(date), name: item.displayName, recurringSeriesKey: item.recurringSeriesKey });
      }
    }
    occurrences.sort((left, right) => left.date.localeCompare(right.date) || left.recurringSeriesKey - right.recurringSeriesKey);
    occurrencesByMonth.push(occurrences);

    return {
      income: sumMoney(input.incomes.map((income) => income.amount)),
      month: month.month,
      rows: rows.map((row): ForecastRowInput => {
        const categoryKey = row.categoryKey.categoryKey;
        const carry = rollover.get(categoryKey);
        return {
          budgeted: monthlyPlan(row.amountBudgeted ?? 0, row.recurrency),
          categoryKey,
          projected: sumMoney(projected.get(categoryKey) ?? []),
          projectedComplete: !missing.has(categoryKey),
          rolloverEnabled: row.rolloverEnabled,
          ...(index === 0 && {
            carriedIn: carry?.rolledOver ?? 0,
            carriedInComplete: !(carry?.rolledOverIncomplete ?? false),
            spent: spentByCategory.get(categoryKey) ?? 0,
            spentComplete: spendingComplete,
          }),
        };
      }),
      year: month.year,
    };
  });

  const months = computeForecast(inputs, { carryOverspend: budget.rolloverCarriesOverspend }).map((month, index) => ({ ...month, recurring: occurrencesByMonth[index] ?? [] }));
  const unconvertedCurrencies = new Set(spending?.completeness.unconvertedCurrencies ?? []);
  for (const { currencyCode, item } of valued) if (unconverted.has(item.recurringSeriesKey) && currencyCode) unconvertedCurrencies.add(currencyCode);
  const rolloverComplete = [...rollover.values()].every((category) => !category.rolledOverIncomplete);

  return {
    asOf,
    basis: {
      plannedIncome: input.incomes.map((income) => ({ amount: income.amount, name: income.name })),
      recurringItems: valued.flatMap(({ amount, categoryKey, currencyCode, item, originalAmount }) => (amount != null && currencyCode && used.has(item.recurringSeriesKey)
        ? [{ amount, cadence: item.cadence, categoryKey, currencyCode, name: item.displayName, originalAmount, recurringSeriesKey: item.recurringSeriesKey }]
        : [])),
    },
    budgetKey: budget.budgetKey,
    completeness: {
      currencyCode: currency.code,
      isComplete: spendingComplete && rolloverComplete && unconverted.size === 0,
      unconvertedCurrencies: [...unconvertedCurrencies].sort(),
      unconvertedRecurringItems: unconverted.size,
      unconvertedTransactions: spending?.completeness.unconvertedTransactions ?? 0,
    },
    currencyCode: currency.code,
    months,
  };
}

/**
 * The household's recurring items that may fall in the window: in one of the window's categories,
 * on one of its accounts, with a next date. Read through the request's filters, so a partner's item
 * on their private account stays theirs.
 */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function loadSeries(em: EntityManager, tenantKey: number, rows: BudgetTemplateCategory[], accountKeys: Set<number>, windowEnd: Date) {
  return em.find(RecurringSeries, {
    accountKey: { accountKey: { $in: [...accountKeys] } },
    categoryKey: { categoryKey: { $in: [...new Set(rows.map((row) => row.categoryKey.categoryKey))] } },
    deletedAt: null,
    nextExpectedAt: { $lte: windowEnd, $ne: null },
    status: { $in: [RecurringSeriesStatus.confirmed, RecurringSeriesStatus.candidate] },
    tenantKey: { tenantKey },
  }, { orderBy: { recurringSeriesKey: 'asc' }, populate: ['accountKey', 'currencyKey', 'categoryKey', 'categoryKey.parentCategory'] });
}
