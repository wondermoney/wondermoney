import { DI } from '@app/database/di';
import { Transaction } from '@entity/Transaction';
import { getEffectiveAppuserAmount } from '@utils/account-amounts';
import { addMoney } from '@utils/money';

import { round2, toCsv } from './csv';
import { buildTransactionWhere, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';
import { getMonthKey, getMonthStartIso, resolveReportTimeZone } from './report-months';

/**
 * Monthly cash flow.
 *
 * Two contract points worth stating, because both surfaces depend on them:
 *
 * 1. **Months are bucketed in the caller's calendar** (the `timezone` filter,
 *    defaulting to `REPORT_DEFAULT_TIME_ZONE`), not in UTC, so the month a row
 *    claims and the instants the filter selected are the same period. See
 *    `report-months.ts` for why a calendar has to be assumed at all.
 * 2. **A month with no matching transaction is absent, never a zero row.**
 *    Absence means "nothing to say"; a present row netting to `0` is a measured
 *    zero. Emitting explicit empty months would collapse that distinction, and
 *    the shipped web chart (`web/lib/reports/cashflow-series.ts`) reads exactly
 *    this rule to draw gaps rather than fake €0 measurements.
 *
 * The CSV export is rendered from the same rows the JSON response returns
 * ({@link getCashflowCsv} wraps {@link getCashflowReport}), so the two surfaces
 * cannot drift.
 */

export interface CashflowRow {
  expenses: number;
  income: number;
  month: string;
  net: number;
}

const CATEGORY_POPULATE = [
  'appuserTransactionCategories.categoryKey',
  'appuserCurrencyKey',
] as const;

export function buildCashflowCsv(rows: CashflowRow[]): string {
  const header = ['month', 'income', 'expenses', 'net'];
  const body = rows.map((row) => [
    row.month,
    row.income.toFixed(2),
    row.expenses.toFixed(2),
    row.net.toFixed(2),
  ]);
  return toCsv(header, body);
}

/**
 * The CSV export, rendered from the rows the JSON response returns.
 *
 * The only CSV entry point: the controller cannot assemble its own rows, so the
 * export and the chart are the same numbers by construction.
 */
export async function getCashflowCsv(input: ReportServiceInput): Promise<string> {
  return buildCashflowCsv(await getCashflowReport(input));
}

export async function getCashflowReport(input: ReportServiceInput): Promise<CashflowRow[]> {
  const { filters, tenant, user } = input;

  const transactions = await DI.em.find(Transaction, buildTransactionWhere(filters, tenant, user), {
    populate: filters.categoryKeys !== undefined ? CATEGORY_POPULATE : undefined,
  });

  const categoryKeys = filters.categoryKeys;
  const timeZone = resolveReportTimeZone(filters.timezone);
  const monthlyTotals = new Map<string, { expenses: number; income: number; }>();
  for (const transaction of transactions) {
    if (!transaction.transactionDate) continue;
    if (categoryKeys !== undefined && !transactionMatchesCategoryKeys(transaction, categoryKeys)) continue;

    const amount = getEffectiveAppuserAmount(transaction);
    const monthKey = getMonthKey(transaction.transactionDate, timeZone);
    const current = monthlyTotals.get(monthKey);
    const next = current ?? { expenses: 0, income: 0 };
    // Money arithmetic, not float accumulation, for the monthly totals.
    if (amount > 0) next.income = addMoney(next.income, amount);
    else next.expenses = addMoney(next.expenses, Math.abs(amount));
    monthlyTotals.set(monthKey, next);
  }

  return [...monthlyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, totals]) => {
      const income = round2(totals.income);
      const expenses = round2(totals.expenses);
      return {
        expenses,
        income,
        month: getMonthStartIso(monthKey),
        net: round2(income - expenses),
      };
    });
}
