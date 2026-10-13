import { DI } from '@app/database/di';
import { LoanRepaymentLink } from '@entity/LoanRepaymentLink';
import { Transaction } from '@entity/Transaction';
import { calculateEffectiveSpendingAmount } from '@service/loan/loan-spending-adjustment.service';
import { filterExpenseTransactions, getEffectiveAppuserAmount } from '@utils/account-amounts';

import { round2, toCsv } from './csv';
import { buildTransactionWhere, type ReportServiceInput, transactionMatchesCategoryKeys } from './report-filters';

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

export async function getSpendingByCategoryReport(input: ReportServiceInput): Promise<SpendingByCategoryRow[]> {
  const { filters, tenant, user } = input;

  const transactions = await DI.em.find(Transaction, buildTransactionWhere(filters, tenant, user), {
    populate: [
      'appuserTransactionCategories.categoryKey',
      'appuserTransactionCategories.categoryKey.parentCategory',
      'appuserCurrencyKey',
    ],
  });
  if (transactions.length === 0) return [];

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

  const categoryKeys = filters.categoryKeys;
  const expenseTransactions = filterExpenseTransactions(transactions).filter(
    (transaction) => categoryKeys === undefined || transactionMatchesCategoryKeys(transaction, categoryKeys),
  );
  if (expenseTransactions.length === 0) return [];

  const byCategory = new Map<string, SpendingByCategoryRow>();
  for (const transaction of expenseTransactions) {
    const effectiveAmount = calculateEffectiveSpendingAmount({
      loanRepaymentLinks: loanRepaymentLinkMap.get(transaction.transactionKey) ?? [],
      transactionAmount: getEffectiveAppuserAmount(transaction),
    });
    const assignedCategory = transaction.appuserTransactionCategories.getItems()[0]?.categoryKey;
    const categoryKey = assignedCategory ? String(assignedCategory.categoryKey) : UNCATEGORIZED_KEY;
    const parentKey = assignedCategory?.parentCategory ? String(assignedCategory.parentCategory.categoryKey) : null;
    const name = assignedCategory?.name ?? 'Uncategorized';
    const color = assignedCategory?.bgColor ?? UNCATEGORIZED_COLOR;

    const current = byCategory.get(categoryKey);
    if (current) {
      current.totalAmount += Math.abs(effectiveAmount);
      current.transactionCount += 1;
      continue;
    }
    byCategory.set(categoryKey, {
      categoryKey,
      color,
      name,
      parentKey,
      percentOfTotal: 0,
      totalAmount: Math.abs(effectiveAmount),
      transactionCount: 1,
    });
  }

  const rows = [...byCategory.values()];
  const grandTotal = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  rows.sort((a, b) => b.totalAmount - a.totalAmount);

  return rows.map((row) => ({
    categoryKey: row.categoryKey,
    color: row.color,
    name: row.name,
    parentKey: row.parentKey,
    percentOfTotal: grandTotal > 0 ? round2((row.totalAmount / grandTotal) * 100) : 0,
    totalAmount: round2(row.totalAmount),
    transactionCount: row.transactionCount,
  }));
}
