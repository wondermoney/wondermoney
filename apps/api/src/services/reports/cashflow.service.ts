import { DI } from '@app/database/di';
import { Transaction } from '@entity/Transaction';
import { rateScope } from '@service/currency/exchange-rate';
import { CATEGORY_LINE_POPULATE, spendingLinesOf } from '@service/transaction/category-lines';
import { loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { transactionCalendarDay } from '@service/transaction/transaction-date-range';
import { addMoney, sumMoney } from '@utils/money';

import { round2, toCsv } from './csv';
import { loadViewerCurrencyAmounts, REPORT_CURRENCY_POPULATE, type ReportResult } from './report-currency';
import { buildTransactionWhere, lineMatchesCategoryKeys, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';
import { getMonthStartIso, resolveReportTimeZone } from './report-months';

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

const CATEGORY_POPULATE = [...CATEGORY_LINE_POPULATE, ...REPORT_CURRENCY_POPULATE] as const;

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
  return buildCashflowCsv((await getCashflowReport(input)).data);
}

export async function getCashflowReport(input: ReportServiceInput): Promise<ReportResult<CashflowRow[]>> {
  const { filters, tenant, user } = input;

  const transactions = await DI.em.find(Transaction, buildTransactionWhere(filters, tenant, user), {
    populate: CATEGORY_POPULATE,
  });
  const amounts = await loadViewerCurrencyAmounts(DI.em, user, rateScope(tenant), transactions);
  const spendingFlags = await loadCategorySpendingFlags(DI.em, tenant.tenantKey);

  const categoryKeys = filters.categoryKeys;
  const timeZone = resolveReportTimeZone(filters.timezone);
  const monthlyTotals = new Map<string, { expenses: number; income: number; }>();
  for (const transaction of transactions) {
    if (!transaction.transactionDate) continue;
    if (categoryKeys !== undefined && !transactionMatchesCategoryKeys(transaction, categoryKeys)) continue;

    // In the viewer's currency; a row no rate converts is left out and counted. A line in a category
    // that is not spending (investments, savings) is left out, in and out; with a category filter,
    // a split transaction counts only its matching lines.
    const converted = amounts.amountOf(transaction);
    if (converted === null) continue;
    const lines = spendingLinesOf(transaction, converted, spendingFlags).filter((line) => lineMatchesCategoryKeys(line, categoryKeys));
    if (lines.length === 0) continue;
    const amount = sumMoney(lines.map((line) => line.amount));
    // A bank booking is in the month of its own date.
    const monthKey = transactionCalendarDay(transaction.transactionDate, timeZone).slice(0, 7);
    const current = monthlyTotals.get(monthKey);
    const next = current ?? { expenses: 0, income: 0 };
    // Money arithmetic, not float accumulation, for the monthly totals.
    if (amount > 0) next.income = addMoney(next.income, amount);
    else next.expenses = addMoney(next.expenses, Math.abs(amount));
    monthlyTotals.set(monthKey, next);
  }

  const data = [...monthlyTotals.entries()]
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
  return { completeness: amounts.completeness(), data };
}
