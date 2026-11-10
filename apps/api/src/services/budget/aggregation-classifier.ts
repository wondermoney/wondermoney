import Big from 'big.js';

import type { AggregationDiagnostics, BudgetThresholdState, TransactionAggregationRow } from './aggregation-types';

export interface CategorizedTransaction {
  accountKey: number;
  amount: Big;
  categoryKey: number;
  categoryName: string;
  parentCategoryKey: null | number;
  parentCategoryName: null | string;
  transactionDate: Date;
  transactionKey: number;
}

export interface ClassifiedThreshold {
  claimThresholds: (80 | 100)[];
  state: BudgetThresholdState;
  threshold: 80 | 100;
}

export function classifyBudgetThreshold(spent: Big, budgeted: Big): ClassifiedThreshold | null {
  if (budgeted.lte(0)) return null;
  const scaled = spent.times(100);
  const atHundred = scaled.gte(budgeted.times(100));
  if (atHundred) {
    return {
      claimThresholds: [80, 100],
      state: scaled.eq(budgeted.times(100)) ? 'at_limit' : 'over',
      threshold: 100,
    };
  }
  if (scaled.gte(budgeted.times(80))) return { claimThresholds: [80], state: 'near', threshold: 80 };
  return null;
}

export function classifyTransactions(
  rows: TransactionAggregationRow[],
  appuserKey: number,
  tenantKey: number,
  diagnostics: AggregationDiagnostics,
): CategorizedTransaction[] {
  const byTransaction = new Map<number, TransactionAggregationRow[]>();
  for (const row of rows) {
    const group = byTransaction.get(row.transactionKey) ?? [];
    group.push(row);
    byTransaction.set(row.transactionKey, group);
  }

  const transactions: CategorizedTransaction[] = [];
  for (const transactionRows of byTransaction.values()) {
    const first = transactionRows[0];
    if (!first) continue;
    // A split transaction has one row per line by design; only rows beyond that are duplicates.
    const splitLineCount = new Set(transactionRows.flatMap((row) => (row.splitKey == null ? [] : [row.splitKey]))).size;
    diagnostics.duplicateTransactionRows += Math.max(0, transactionRows.length - Math.max(1, splitLineCount));
    if (
      first.appuserKey !== appuserKey ||
      first.tenantKey !== tenantKey ||
      first.accountOwnerAppuserKey !== appuserKey ||
      first.accountTenantKey !== tenantKey ||
      first.accountClosed ||
      first.accountDeleted
    ) {
      diagnostics.invalidAccounts += 1;
      continue;
    }
    if (first.transactionType === 'TRANSFER_IN' || first.transactionType === 'TRANSFER_OUT') {
      diagnostics.excludedTransfers += 1;
      continue;
    }
    if (!first.transactionDate) {
      diagnostics.invalidTransactionDates += 1;
      continue;
    }
    if (first.effectiveAmount == null) {
      diagnostics.missingConvertedAmounts += 1;
      continue;
    }

    const loanLinks = uniqueBy(
      transactionRows.filter((row) => row.loanLinkKey != null && !row.loanLinkDeleted),
      (row) => row.loanLinkKey ?? 0,
    );
    let amount: Big;
    if (loanLinks.length > 0) {
      const validLinks = loanLinks.filter(
        (row) => row.loanLinkTenantKey === tenantKey && row.loanLinkedByAppuserKey === appuserKey,
      );
      if (validLinks.length !== loanLinks.length) {
        diagnostics.invalidLoanLinks += 1;
        continue;
      }
      amount = validLinks.reduce(
        (sum, link) => sum.plus(link.loanInterestAmount ?? 0).plus(link.loanFeeAmount ?? 0),
        new Big(0),
      );
    } else {
      amount = new Big(first.effectiveAmount).times(-1);
    }

    const countableCategory = (row: TransactionAggregationRow) =>
      row.assignmentAppuserKey === appuserKey &&
      row.categoryKey != null &&
      !row.categoryDeleted &&
      !row.categoryHasActiveChildren &&
      row.parentCategoryKey != null &&
      !row.parentCategoryDeleted &&
      (row.categorySystem === true || row.categoryOwnerAppuserKey === appuserKey) &&
      (row.parentCategorySystem === true || row.parentCategoryOwnerAppuserKey === appuserKey);

    // A split transaction counts each line in its own category, with the line's share of the
    // amount; a line that is uncategorized (or in a category this member cannot count) is left
    // out like an uncategorized transaction. A loan repayment is never split.
    // A line in a category that is not spending (investments, savings) is left out altogether.
    const splitLines = uniqueBy(transactionRows.filter((row) => row.splitKey != null), (row) => row.splitKey ?? 0);
    if (splitLines.length > 0 && loanLinks.length === 0) {
      const spendingLines = splitLines.filter((row) => row.countsAsSpending !== false);
      if (spendingLines.length === 0) {
        diagnostics.excludedNonSpending += 1;
        continue;
      }
      const counted = spendingLines.filter(countableCategory);
      if (counted.length < spendingLines.length) diagnostics.uncategorizedTransactions += 1;
      for (const line of counted) {
        if (line.categoryKey == null || line.categoryName == null || line.lineAmount == null) continue;
        transactions.push({
          accountKey: first.accountKey,
          amount: new Big(line.lineAmount).times(-1),
          categoryKey: line.categoryKey,
          categoryName: line.categoryName,
          parentCategoryKey: line.parentCategoryKey,
          parentCategoryName: line.parentCategoryName,
          transactionDate: first.transactionDate,
          transactionKey: first.transactionKey,
        });
      }
      continue;
    }

    const assignments = uniqueBy(
      transactionRows.filter((row) => row.splitKey == null && row.assignmentKey != null && !row.assignmentDeleted && countableCategory(row)),
      (row) => row.categoryKey ?? 0,
    );
    if (assignments.length === 0) {
      diagnostics.uncategorizedTransactions += 1;
      continue;
    }
    if (assignments.length > 1) {
      diagnostics.ambiguousCategoryAssignments += 1;
      continue;
    }
    const assignment = assignments[0];
    if (assignment?.categoryKey == null || assignment.categoryName == null) continue;
    if (assignment.countsAsSpending === false) {
      diagnostics.excludedNonSpending += 1;
      continue;
    }
    transactions.push({
      accountKey: first.accountKey,
      amount,
      categoryKey: assignment.categoryKey,
      categoryName: assignment.categoryName,
      parentCategoryKey: assignment.parentCategoryKey,
      parentCategoryName: assignment.parentCategoryName,
      transactionDate: first.transactionDate,
      transactionKey: first.transactionKey,
    });
  }
  return transactions;
}

export function createDiagnostics(): AggregationDiagnostics {
  return {
    ambiguousCategoryAssignments: 0,
    duplicateTransactionRows: 0,
    excludedNonSpending: 0,
    excludedTransfers: 0,
    invalidAccounts: 0,
    invalidLoanLinks: 0,
    invalidTransactionDates: 0,
    missingConvertedAmounts: 0,
    uncategorizedTransactions: 0,
  };
}

export function floorMoney(value: Big): Big {
  return value.lt(0) ? new Big(0) : value;
}

export function money(value: Big): string {
  return value.toFixed(4).replace(/\.?0+$/, '');
}

function uniqueBy<T>(values: T[], key: (value: T) => number): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
