import { startOfMonth } from 'date-fns';

import { DI } from '@app/database/di';
import { Budget } from '@entity/Budget';
import { BudgetTemplateCategory } from '@entity/BudgetTemplateCategory';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';
import { calculateEffectiveSpendingAmount } from '@service/loan/loan-spending-adjustment.service';
import { filterExpenseTransactions, getEffectiveAppuserAmount } from '@utils/account-amounts';

import { round2, toCsv } from './csv';
import { buildTransactionWhere, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';
import { getMonthKey, resolveReportTimeZone } from './report-months';

export interface BudgetVsActualRow {
  actual: number;
  budgeted: number;
  categoryKey: string;
  color: string;
  name: string;
  percentUsed: number;
  variance: number;
}

const CATEGORY_POPULATE = [
  'appuserTransactionCategories.categoryKey',
  'appuserTransactionCategories.categoryKey.parentCategory',
  'appuserCurrencyKey',
] as const;

export async function getBudgetVsActualReport(input: ReportServiceInput): Promise<BudgetVsActualRow[]> {
  const { filters, tenant, user } = input;

  // Budgets are household-shared (RAD-343): tenant-scoped.
  const budgets = await DI.em.find(Budget, { deletedAt: undefined, tenantKey: tenant });
  if (budgets.length === 0) return [];
  const budget = budgets[0];

  const templates = await DI.em.find(
    BudgetTemplateCategory,
    { budgetKey: budget },
    { populate: ['categoryKey', 'accounts'] },
  );
  if (templates.length === 0) return [];

  const fromDate = filters.fromDate ? new Date(filters.fromDate) : startOfMonth(new Date());
  const toDate = filters.toDate ? new Date(filters.toDate) : new Date();
  const coveredMonths = getMonthsInRange(fromDate, toDate, resolveReportTimeZone(filters.timezone));

  const budgetedByCategory = new Map<number, number>();
  const categoryInfo = new Map<number, { color: string; name: string }>();
  const budgetAccountKeys = new Set<number>();
  for (const template of templates) {
    if (!coveredMonths.has(monthKey(template.year, template.month))) continue;
    budgetedByCategory.set(
      template.categoryKey.categoryKey,
      (budgetedByCategory.get(template.categoryKey.categoryKey) ?? 0) + (template.amountBudgeted ?? 0),
    );
    categoryInfo.set(template.categoryKey.categoryKey, {
      color: template.categoryKey.bgColor,
      name: template.categoryKey.name,
    });
    for (const account of template.accounts.getItems()) budgetAccountKeys.add(account.accountKey);
  }
  // No budget rows overlap the requested period: return an empty dataset rather
  // than erroring, so the web layer can render its "set up a budget" empty state.
  if (budgetedByCategory.size === 0) return [];

  const where = buildTransactionWhere(filters, tenant, user);
  if (budgetAccountKeys.size > 0) {
    const accountCondition = where['accountKey'] as Record<string, unknown>;
    accountCondition['accountKey'] = { $in: [...budgetAccountKeys] };
  }

  const transactions = await DI.em.find(Transaction, where, { populate: CATEGORY_POPULATE });

  const loanRepaymentLinks = await DI.em.find(LoanRepaymentLink, {
    deletedAt: undefined,
    tenantKey: tenant,
    transactionKey: { $in: transactions },
  });
  const loanRepaymentLinkMap = new Map<number, LoanRepaymentLink[]>();
  for (const link of loanRepaymentLinks) {
    const transactionKey = link.transactionKey.transactionKey;
    const current = loanRepaymentLinkMap.get(transactionKey);
    if (current) current.push(link);
    else loanRepaymentLinkMap.set(transactionKey, [link]);
  }

  const categoryKeysFilter = filters.categoryKeys;
  const actualByCategory = new Map<number, number>();
  for (const transaction of filterExpenseTransactions(transactions)) {
    if (categoryKeysFilter !== undefined && !transactionMatchesCategoryKeys(transaction, categoryKeysFilter)) continue;
    const assignedCategory = transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
    if (!assignedCategory) continue;
    const budgetCategoryKey = resolveBudgetCategoryKey(budgetedByCategory, assignedCategory);
    if (budgetCategoryKey === null) continue;
    const effectiveAmount = calculateEffectiveSpendingAmount({
      loanRepaymentLinks: loanRepaymentLinkMap.get(transaction.transactionKey) ?? [],
      transactionAmount: getEffectiveAppuserAmount(transaction),
    });
    actualByCategory.set(budgetCategoryKey, (actualByCategory.get(budgetCategoryKey) ?? 0) + Math.abs(effectiveAmount));
  }

  const rows = [...budgetedByCategory.entries()]
    .map(([categoryKey, budgeted]) => {
      const info = categoryInfo.get(categoryKey);
      const actual = round2(actualByCategory.get(categoryKey) ?? 0);
      const budgetedRounded = round2(budgeted);
      return {
        actual,
        budgeted: budgetedRounded,
        categoryKey: String(categoryKey),
        color: info?.color ?? '#000000',
        name: info?.name ?? 'Uncategorized',
        percentUsed: budgetedRounded > 0 ? round2((actual / budgetedRounded) * 100) : 0,
        variance: round2(budgetedRounded - actual),
      };
    })
    .sort((a, b) => b.budgeted - a.budgeted);

  return rows;
}

/**
 * Budgets live on parent categories while transactions are categorized on child
 * categories, so a transaction counts toward the budgeted category when its
 * assigned category (or that category's parent) is the budgeted one.
 */
export function buildBudgetVsActualCsv(rows: BudgetVsActualRow[]): string {
  const header = ['categoryKey', 'name', 'color', 'budgeted', 'actual', 'variance', 'percentUsed'];
  const body = rows.map((row) => [
    row.categoryKey,
    row.name,
    row.color,
    row.budgeted.toFixed(2),
    row.actual.toFixed(2),
    row.variance.toFixed(2),
    row.percentUsed.toFixed(2),
  ]);
  return toCsv(header, body);
}

/**
 * RAD-565 — the covered-month set and the budget template rows are joined on
 * this key, so both sides must build it the same way. Zero-padded, which the
 * old `${year}-${month + 1}` form was not.
 *
 * The key never leaves this service; it is not part of the response.
 */
function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * The calendar months the requested period touches, read in the caller's zone.
 *
 * Walking year/month as integers rather than stepping a `Date` keeps this free
 * of zoned-date arithmetic: only the two endpoints are resolved through `Intl`.
 */
function getMonthsInRange(from: Date, to: Date, timeZone: string): Set<string> {
  const months = new Set<string>();
  const [fromYear, fromMonth] = getMonthKey(from, timeZone).split('-').map(Number) as [number, number];
  const [toYear, toMonth] = getMonthKey(to, timeZone).split('-').map(Number) as [number, number];

  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.add(monthKey(year, month));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function resolveBudgetCategoryKey(
  budgetedByCategory: ReadonlyMap<number, number>,
  assignedCategory: { categoryKey: number; parentCategory?: null | { categoryKey: number } },
): null | number {
  if (budgetedByCategory.has(assignedCategory.categoryKey)) return assignedCategory.categoryKey;
  const parentKey = assignedCategory.parentCategory?.categoryKey;
  if (parentKey !== undefined && budgetedByCategory.has(parentKey)) return parentKey;
  return null;
}
