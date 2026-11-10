import type { EntityManager } from '@mikro-orm/postgresql';

import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { convertRecurrencyIntoMonthsInYear, Recurrency } from '@utils/budget';
import { addMoney, big, sumMoney, toNumber } from '@utils/money';

import { computeRollover, monthIndex, type RolloverMonthResult } from './budget-rollover';
import { type BudgetSpendingCategory, getBudgetRowSpending } from './spending';

/** One stored budget row, as rollover needs it. */
export interface MonthRolloverInput {
  carryOverspend: boolean;
  currency: { code: string; currencyKey: number };
  month: number;
  /** Every stored row of the budget (any year): the months before `month` are walked from these. */
  rows: RolloverBudgetRow[];
  tenantKey: number;
  viewerAppuserKey: number;
  year: number;
}

export interface RolloverBudgetRow {
  /** The accounts linked to the row: a month's spending counts the accounts of all its rows. */
  accountKeys: number[];
  amountBudgeted: number;
  budgetTemplateCategoryKey: number;
  categoryKey: number;
  month: number;
  rolloverEnabled: boolean;
  year: number;
}

/**
 * The rollover of each category in one budget month, keyed by category, for the categories whose
 * row has rollover on.
 *
 * Computed on read, never stored, so an edit to a past transaction, a budget amount or a rate shows
 * at once. For each such category it walks back over the unbroken run of earlier months with
 * rollover on, measures those months with the budget's own spending query (each month with the
 * accounts it counts), and runs {@link computeRollover} over the run.
 */
export async function getMonthRollover(input: MonthRolloverInput): Promise<Map<number, RolloverMonthResult>> {
  const target = monthIndex(input);
  const byCategory = new Map<number, Map<number, RolloverBudgetRow>>();
  for (const row of input.rows) {
    const months = byCategory.get(row.categoryKey) ?? new Map<number, RolloverBudgetRow>();
    months.set(monthIndex(row), row);
    byCategory.set(row.categoryKey, months);
  }

  // Each category's run of earlier months that carry into the target month, oldest first.
  const chains = new Map<number, { current: RolloverBudgetRow; earlier: RolloverBudgetRow[] }>();
  for (const [categoryKey, months] of byCategory) {
    const current = months.get(target);
    if (!current?.rolloverEnabled) continue;
    const earlier: RolloverBudgetRow[] = [];
    for (let row = months.get(target - 1); row?.rolloverEnabled; row = months.get(monthIndex(row) - 1)) earlier.unshift(row);
    chains.set(categoryKey, { current, earlier });
  }

  const spending = await measureMonths(input, [...chains.values()].flatMap((chain) => chain.earlier));

  const result = new Map<number, RolloverMonthResult>();
  for (const [categoryKey, { current, earlier }] of chains) {
    const months = [...earlier, current].map((row) => {
      const spent = spending.get(row.budgetTemplateCategoryKey);
      return { budgeted: row.amountBudgeted, month: row.month, rolloverEnabled: true, spendingComplete: spent?.complete ?? true, spent: spent?.spent ?? 0, year: row.year };
    });
    const last = computeRollover(months, { carryOverspend: input.carryOverspend }).at(-1);
    if (last) result.set(categoryKey, last);
  }
  return result;
}

/**
 * Spending of `rows`, each in its own month. A budget month counts the accounts linked to any of its
 * rows, so months are grouped by that account set and each group is one spending query.
 */
async function measureMonths(input: MonthRolloverInput, rows: RolloverBudgetRow[]) {
  const accountsByMonth = new Map<number, Set<number>>();
  for (const row of input.rows) {
    const accounts = accountsByMonth.get(monthIndex(row)) ?? new Set<number>();
    for (const accountKey of row.accountKeys) accounts.add(accountKey);
    accountsByMonth.set(monthIndex(row), accounts);
  }
  const groups = new Map<string, { accountKeys: number[]; templateKeys: number[] }>();
  for (const row of rows) {
    const accountKeys = [...(accountsByMonth.get(monthIndex(row)) ?? [])].sort((left, right) => left - right);
    const key = accountKeys.join(',');
    const group = groups.get(key) ?? { accountKeys, templateKeys: [] };
    group.templateKeys.push(row.budgetTemplateCategoryKey);
    groups.set(key, group);
  }
  const results = await Promise.all([...groups.values()].map((group) => getBudgetRowSpending({
    accountKeys: group.accountKeys,
    currency: input.currency,
    templateKeys: group.templateKeys,
    tenantKey: input.tenantKey,
    viewerAppuserKey: input.viewerAppuserKey,
  })));
  return new Map(results.flatMap((result) => [...result]));
}

/**
 * The available amount (budget plus rollover) of each budget row in one month that has rollover on,
 * keyed by `budgetTemplateCategoryKey`, for budget emails and badges. The carry is the one the app
 * shows `viewerAppuserKey`. Runs outside a request (the worker), so the budgets are read without
 * the tenant filter and each is measured within its own household.
 */
export interface BudgetCategoryWithRollover extends BudgetSpendingCategory {
  /**
   * What the month may spend: its monthly plan (`category_budgeted_amount` spread by its
   * recurrency, as the month shows it) plus `category_rolled_over`. A parent row adds up its
   * subcategories'.
   */
  category_available: number;
  /** What last month left over (negative when it overspent); 0 without rollover. */
  category_rolled_over: number;
  /** The row has rollover on (a parent row: any of its subcategories). */
  category_rollover_enabled: boolean;
  /** The carried amount rests on a month with spending that could not be converted. */
  category_rollover_incomplete: boolean;
}

export async function loadAvailableAmounts(
  em: EntityManager,
  input: { budgetKeys: number[]; month: number; viewerAppuserKey: number; year: number },
): Promise<Map<number, number>> {
  const available = new Map<number, number>();
  if (input.budgetKeys.length === 0) return available;
  const work = em.fork();
  const enabled = await work.count(BudgetTemplateCategory, { budgetKey: { budgetKey: { $in: input.budgetKeys } }, month: input.month, rolloverEnabled: true, year: input.year }, { filters: false });
  if (enabled === 0) return available;

  const budgets = await work.find(
    Budget,
    { budgetKey: { $in: input.budgetKeys }, deletedAt: null },
    { filters: false, populate: ['currencyKey', 'budgetTemplatesCategory', 'budgetTemplatesCategory.accounts'] },
  );
  for (const budget of budgets) {
    const rows = rolloverRowsOf(budget.budgetTemplatesCategory.getItems());
    const rollover = await getMonthRollover({
      carryOverspend: budget.rolloverCarriesOverspend,
      currency: budget.currencyKey,
      month: input.month,
      rows,
      tenantKey: budget.tenantKey.tenantKey,
      viewerAppuserKey: input.viewerAppuserKey,
      year: input.year,
    });
    for (const row of rows) {
      const category = row.year === input.year && row.month === input.month ? rollover.get(row.categoryKey) : undefined;
      if (category) available.set(row.budgetTemplateCategoryKey, category.available);
    }
  }
  return available;
}

/**
 * A row's monthly plan: its amount spread over the year by its recurrency (120 a quarter is 40 a
 * month), as web and mobile show it. Rollover carries and adds to this figure.
 */
export function monthlyPlan(amount: number, recurrency: null | string | undefined): number {
  return toNumber(big(amount).times(convertRecurrencyIntoMonthsInYear(recurrency ?? Recurrency.MONTHLY)).div(12));
}

/** A budget's stored rows (with their accounts populated) as rollover reads them. */
export function rolloverRowsOf(templates: BudgetTemplateCategory[]): RolloverBudgetRow[] {
  return templates.map((template) => ({
    accountKeys: template.accounts.getItems().map((account) => account.accountKey),
    amountBudgeted: monthlyPlan(template.amountBudgeted ?? 0, template.recurrency),
    budgetTemplateCategoryKey: template.budgetTemplateCategoryKey,
    categoryKey: template.categoryKey.categoryKey,
    month: template.month,
    rolloverEnabled: template.rolloverEnabled,
    year: template.year,
  }));
}

/**
 * Add each category's rollover to a budget month's spending rows. A subcategory row takes its own;
 * a parent row (no `child_category_name`) adds up its subcategories'.
 */
export function withRollover(
  categories: BudgetSpendingCategory[],
  rollover: Map<number, RolloverMonthResult>,
): BudgetCategoryWithRollover[] {
  const withOwn = categories.map((row) => {
    if (row.child_category_name == null) return null;
    const own = rollover.get(row.category_key);
    const rolledOver = own?.rolledOver ?? 0;
    return {
      ...row,
      category_available: addMoney(monthlyPlan(row.category_budgeted_amount, row.category_recurrency), rolledOver),
      category_rolled_over: rolledOver,
      category_rollover_enabled: own != null,
      category_rollover_incomplete: own?.rolledOverIncomplete ?? false,
    };
  });
  const children = withOwn.filter((row) => row != null);
  return categories.map((row, index) => {
    const child = withOwn[index];
    if (child) return child;
    const subcategories = children.filter((candidate) => candidate.parent_category_name === row.parent_category_name);
    return {
      ...row,
      category_available: sumMoney(subcategories.map((candidate) => candidate.category_available)),
      category_rolled_over: sumMoney(subcategories.map((candidate) => candidate.category_rolled_over)),
      category_rollover_enabled: subcategories.some((candidate) => candidate.category_rollover_enabled),
      category_rollover_incomplete: subcategories.some((candidate) => candidate.category_rollover_incomplete),
    };
  });
}
