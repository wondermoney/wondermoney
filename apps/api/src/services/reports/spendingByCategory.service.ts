import { DI } from '@app/database/di';
import { Transaction } from '@entity/Transaction';
import { rateScope } from '@service/currency/exchange-rate';
import { CATEGORY_LINE_POPULATE, spendingLinesOf } from '@service/transaction/category-lines';
import { loadCategorySpendingFlags } from '@service/transaction/category-spending';
import { addMoney } from '@utils/money';

import { round2, toCsv } from './csv';
import { isMoneyOut, loadLoanRepaymentLinks, loadViewerCurrencyAmounts, REPORT_CURRENCY_POPULATE, type ReportResult } from './report-currency';
import { buildTransactionWhere, lineMatchesCategoryKeys, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';

export interface SpendingByCategoryRow {
  categoryKey: string;
  color: string;
  name: string;
  parentKey: null | string;
  percentOfTotal: number;
  totalAmount: number;
  transactionCount: number;
}

const UNCATEGORIZED_COLOR = '#000000';
const UNCATEGORIZED_KEY = '-1';

export function buildSpendingByCategoryCsv(rows: SpendingByCategoryRow[]): string {
  const header = ['categoryKey', 'parentKey', 'name', 'color', 'totalAmount', 'transactionCount', 'percentOfTotal'];
  const body = rows.map((row) => [
    row.categoryKey,
    row.parentKey,
    row.name,
    row.color,
    row.totalAmount.toFixed(2),
    row.transactionCount,
    row.percentOfTotal.toFixed(2),
  ]);
  return toCsv(header, body);
}

export async function getSpendingByCategoryReport(input: ReportServiceInput): Promise<ReportResult<SpendingByCategoryRow[]>> {
  const { filters, tenant, user } = input;

  const transactions = await DI.em.find(Transaction, buildTransactionWhere(filters, tenant, user), {
    populate: [...CATEGORY_LINE_POPULATE, ...REPORT_CURRENCY_POPULATE],
  });
  const repayments = await loadLoanRepaymentLinks(DI.em, tenant, transactions);
  const amounts = await loadViewerCurrencyAmounts(DI.em, user, rateScope(tenant), transactions, repayments);
  const spendingFlags = await loadCategorySpendingFlags(DI.em, tenant.tenantKey);
  const result = (data: SpendingByCategoryRow[]) => ({ completeness: amounts.completeness(), data });
  if (transactions.length === 0) return result([]);

  const categoryKeys = filters.categoryKeys;
  const expenseTransactions = transactions.filter(
    (transaction) => isMoneyOut(transaction) && (categoryKeys === undefined || transactionMatchesCategoryKeys(transaction, categoryKeys)),
  );
  if (expenseTransactions.length === 0) return result([]);

  const byCategory = new Map<string, SpendingByCategoryRow>();
  for (const transaction of expenseTransactions) {
    // A row none of whose lines the total would count (only in categories that are not spending,
    // or outside the category filter) is neither added nor counted as left out.
    if (!spendingLinesOf(transaction, null, spendingFlags).some((line) => lineMatchesCategoryKeys(line, categoryKeys))) continue;
    // In the viewer's currency (a loan repayment by its interest and fees, from the loan's
    // currency); a row with no converted amount, or no rate into the viewer's currency, is left out
    // and counted once (a split's lines share its one converted amount).
    const effectiveAmount = amounts.spendingAmountOf(transaction, repayments.get(transaction.transactionKey) ?? []);
    if (effectiveAmount === null) continue;
    // Each line of a split counts in its own category (and as one entry there), like a separate
    // transaction; with a category filter, only the matching lines count. A line in a category that
    // is not spending (investments, savings) is left out.
    for (const line of spendingLinesOf(transaction, effectiveAmount, spendingFlags)) {
      if (!lineMatchesCategoryKeys(line, categoryKeys)) continue;
      const lineAmount = Math.abs(line.amount ?? 0);
      const assignedCategory = line.category;
      const categoryKey = assignedCategory ? String(assignedCategory.categoryKey) : UNCATEGORIZED_KEY;
      const current = byCategory.get(categoryKey);
      if (current) {
        current.totalAmount = addMoney(current.totalAmount, lineAmount);
        current.transactionCount += 1;
        continue;
      }
      byCategory.set(categoryKey, {
        categoryKey,
        color: assignedCategory?.bgColor ?? UNCATEGORIZED_COLOR,
        name: assignedCategory?.name ?? 'Uncategorized',
        parentKey: assignedCategory?.parentCategory ? String(assignedCategory.parentCategory.categoryKey) : null,
        percentOfTotal: 0,
        totalAmount: lineAmount,
        transactionCount: 1,
      });
    }
  }

  const rows = [...byCategory.values()];
  const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  rows.sort((a, b) => b.totalAmount - a.totalAmount);

  return result(rows.map((row) => ({
    categoryKey: row.categoryKey,
    color: row.color,
    name: row.name,
    parentKey: row.parentKey,
    percentOfTotal: grandTotal > 0 ? round2((row.totalAmount / grandTotal) * 100) : 0,
    totalAmount: round2(row.totalAmount),
    transactionCount: row.transactionCount,
  })));
}
